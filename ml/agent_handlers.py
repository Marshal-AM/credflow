"""HTTP handlers for OZ Defender / Next.js agent routes."""

from __future__ import annotations

import json
import logging
import os
from functools import partial
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from agents.run_logger import AgentRunLogger
from agents.run_log_details import emit_liquidation_details, emit_run_details, emit_underwriter_details

logger = logging.getLogger("credflow.agents")

router = APIRouter(prefix="/agents", tags=["agents"])


class WalletBody(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    trigger_source: str = "manual"
    trigger_event: Optional[str] = None


class SyncScoreBody(WalletBody):
    score: int = Field(..., ge=0, le=1000)


class SyncLoanBody(WalletBody):
    event: str = Field(..., pattern="^(created|repaid)$")
    score: Optional[int] = Field(None, ge=0, le=1000)
    repair_stale: bool = False


class UnderwriteAgentBody(WalletBody):
    rescore: bool = False
    reclaim_session_id: Optional[str] = None
    score_snapshot: Optional[dict] = None
    repay_chain: Optional[str] = None
    repay_tx: Optional[str] = None
    loan_id: Optional[int] = None


class LiquidateBody(WalletBody):
    loan_id: int
    chain: str = "hub"
    force_grace: bool = False


class LoanIdBody(WalletBody):
    loan_id: int


class CrashOracleBody(WalletBody):
    eth_price_usd: float = Field(..., gt=0)


def _check_agent_auth(request: Request) -> None:
    secret = os.environ.get("OZ_DEFENDER_SECRET", "").strip()
    if not secret:
        return
    if request.headers.get("X-Oz-Defender-Secret", "") == secret:
        return
    client_host = request.client.host if request.client else ""
    if client_host in ("127.0.0.1", "localhost", "::1"):
        return
    frontend = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
    for origin in (frontend, "http://127.0.0.1:3000", "http://localhost:3001"):
        if origin in (request.headers.get("origin") or "") or origin in (
            request.headers.get("referer") or ""
        ):
            return
    raise HTTPException(status_code=401, detail="Missing or invalid X-Oz-Defender-Secret")


def _supabase_get(path: str, params: dict | None = None) -> list[dict]:
    cfg_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not cfg_url or not key:
        return []
    url = cfg_url.rstrip("/")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(f"{url}/rest/v1/{path}", headers=headers, params=params or {})
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception as exc:
        logger.warning("Supabase GET failed: %s", exc)
        return []


@router.post("/underwrite")
async def agents_underwrite(req: UnderwriteAgentBody, request: Request):
    _check_agent_auth(request)
    from ml.scoring_api import _executor, _underwrite_sync
    import asyncio

    run = AgentRunLogger(
        "underwriter",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "underwrite",
    )
    run.start()
    if req.repay_chain:
        run.log(
            f"Re-scoring after repay on {req.repay_chain} loan_id={req.loan_id} tx={req.repay_tx}",
            metadata={
                "phase": "context",
                "repay_chain": req.repay_chain,
                "loan_id": req.loan_id,
                "repay_tx": req.repay_tx,
            },
        )
    run.log(
        f"Underwriting wallet={req.wallet_address} rescore={req.rescore}",
        metadata={"phase": "start", "rescore": req.rescore},
    )
    try:
        loop = asyncio.get_event_loop()
        fn = partial(
            _underwrite_sync,
            req.wallet_address,
            rescore=req.rescore,
            reclaim_session_id=req.reclaim_session_id,
            score_snapshot=req.score_snapshot,
        )
        result = await loop.run_in_executor(_executor, fn)
        txs = [result["tx"]] if result.get("tx") else []
        emit_underwriter_details(run, result)
        run.finish(
            success=result.get("action") != "reject",
            summary=f"action={result.get('action')}",
            result=result,
            related_tx_hashes=txs,
        )
        if result.get("action") == "reject":
            raise HTTPException(status_code=400, detail=result)
        return {"run_id": run.run_id, **result}
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        run.finish(success=False, summary="scoring_timed_out", error=str(exc))
        raise HTTPException(
            status_code=504,
            detail=f"Scoring API timed out after {os.environ.get('SCORING_HTTP_TIMEOUT_SEC', '600')}s",
        ) from exc
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/sync-score")
async def agents_sync_score(req: SyncScoreBody, request: Request):
    _check_agent_auth(request)
    from agents.sync_service import sync_wallet_score
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "crosschain_sync",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "sync_score",
    )
    run.start()
    run.log(
        f"broadcastScore wallet={req.wallet_address} score={req.score}",
        metadata={"phase": "start", "score": req.score},
    )
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor, partial(sync_wallet_score, req.wallet_address, req.score)
        )
        txs = result.get("hub_tx_hashes") or []
        emit_run_details(
            run,
            "crosschain_sync",
            [{"wallet": req.wallet_address, "score": req.score, "type": "score", "hub_tx_hashes": txs}],
        )
        run.finish(
            success=True,
            summary=f"Synced score to {len(txs)} destinations",
            result=result,
            related_tx_hashes=[t.get("tx_hash") for t in txs if t.get("tx_hash")],
        )
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/sync-loan")
async def agents_sync_loan(req: SyncLoanBody, request: Request):
    _check_agent_auth(request)
    from agents.sync_service import sync_wallet_loan_active, sync_wallet_repaid
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "crosschain_sync",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or f"loan_{req.event}",
    )
    run.start()
    run.log(
        f"sync-loan event={req.event} wallet={req.wallet_address} repair_stale={req.repair_stale}",
        metadata={"phase": "start", "event": req.event, "score": req.score},
    )
    try:
        loop = asyncio.get_event_loop()
        if req.event == "created":
            fn = partial(sync_wallet_loan_active, req.wallet_address)
        elif req.repair_stale:
            from agents.sync_service import sync_wallet_repaid_clear

            run.log(
                "Clearing stale spoke loanActive mirror (repaid broadcast only)",
                metadata={"phase": "repair", "repair_stale": True},
            )
            fn = partial(sync_wallet_repaid_clear, req.wallet_address)
        elif req.score is not None:
            from agents.sync_service import sync_wallet_repaid_with_score

            fn = partial(sync_wallet_repaid_with_score, req.wallet_address, req.score)
        else:
            fn = partial(sync_wallet_repaid, req.wallet_address)
        result = await loop.run_in_executor(_executor, fn)
        txs = result.get("hub_tx_hashes") or []
        msg_type = result.get("message_type", req.event)
        emit_run_details(
            run,
            "crosschain_sync",
            [
                {
                    "wallet": req.wallet_address,
                    "score": req.score or result.get("score"),
                    "type": msg_type,
                    "hub_tx_hashes": txs,
                }
            ],
        )
        run.finish(
            success=True,
            summary=f"Loan {req.event} synced to {len(txs)} txs",
            result=result,
            related_tx_hashes=[t.get("tx_hash") for t in txs if t.get("tx_hash")],
        )
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/sync")
async def agents_sync_batch(request: Request, body: WalletBody | None = None):
    _check_agent_auth(request)
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "crosschain_sync",
        wallet_address=body.wallet_address if body else None,
        trigger_source=(body.trigger_source if body else "defender_cron"),
        trigger_event=(body.trigger_event if body else "sync_batch"),
    )
    run.start()
    run.log("Running cross-chain sync batch", metadata={"phase": "start"})
    try:
        loop = asyncio.get_event_loop()
        from agents.crosschain_sync import run_loan_sync_once
        from agents.base import CredFlowAgent

        def _batch() -> list[dict]:
            agent = CredFlowAgent()
            items: list[dict] = []
            items.extend(run_sync_once(agent))
            items.extend(run_loan_sync_once(agent))
            return items

        results = await loop.run_in_executor(_executor, _batch)
        emit_run_details(run, "crosschain_sync", results)
        all_txs = []
        for item in results:
            for tx in item.get("hub_tx_hashes") or []:
                if tx.get("tx_hash"):
                    all_txs.append(tx["tx_hash"])
        run.finish(
            success=True,
            summary=f"Synced {len(results)} items",
            result={"items": results},
            related_tx_hashes=all_txs,
        )
        return {"run_id": run.run_id, "items": results}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/monitor")
async def agents_monitor(request: Request, body: WalletBody | None = None):
    _check_agent_auth(request)
    from agents.portfolio_monitor import run_once
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "portfolio_monitor",
        wallet_address=body.wallet_address if body else None,
        trigger_source=(body.trigger_source if body else "defender_cron"),
        trigger_event=(body.trigger_event if body else "health_check"),
    )
    run.start()
    run.log("Portfolio monitor sweep", metadata={"phase": "start"})
    try:
        loop = asyncio.get_event_loop()
        chains = [
            c.strip()
            for c in os.environ.get("AGENT_MONITOR_CHAINS", "hub,arbitrum,base").split(",")
            if c.strip()
        ]

        def _sweep() -> list[dict]:
            results: list[dict] = []
            for chain in chains:
                try:
                    results.extend(run_once(chain))
                except Exception as exc:
                    results.append({"chain": chain, "status": "error", "error": str(exc)})
            return results

        results = await loop.run_in_executor(_executor, _sweep)
        emit_run_details(run, "portfolio_monitor", results)
        run.finish(
            success=True,
            summary=f"Checked {len([r for r in results if r.get('loan_id')])} loans",
            result={"loans": results},
        )
        return {"run_id": run.run_id, "loans": results}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/liquidate")
async def agents_liquidate(req: LiquidateBody, request: Request):
    _check_agent_auth(request)
    from agents.base import CredFlowAgent, SpokeAgent
    from agents.liquidation_agent import LiquidationAgent
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "liquidation",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "default",
    )
    run.start()
    run.log(f"Liquidating loan #{req.loan_id} on {req.chain}")
    try:
        loop = asyncio.get_event_loop()

        def _run() -> dict[str, Any]:
            hub = CredFlowAgent()
            spoke = SpokeAgent(req.chain) if req.chain != "hub" else None
            agent = LiquidationAgent(hub, spoke)
            return agent.execute_liquidation(req.loan_id, force_grace=req.force_grace)

        result = await loop.run_in_executor(_executor, _run)
        emit_liquidation_details(run, result)
        from agents.liquidation_snapshot import snapshot_from_liquidation_result

        snapshot_from_liquidation_result(result)
        txs = [t for t in [result.get("liquidate_tx"), result.get("blacklist_tx")] if t]
        lz = result.get("lz_broadcast_tx")
        if isinstance(lz, list):
            txs.extend([t.get("tx_hash") for t in lz if isinstance(t, dict) and t.get("tx_hash")])
        elif lz:
            txs.append(lz)
        run.finish(success=True, summary=result.get("status", "done"), result=result, related_tx_hashes=txs)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/optimize-rates")
async def agents_optimize_rates(request: Request, body: WalletBody | None = None):
    _check_agent_auth(request)
    from agents.rate_optimizer import run_once
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "rate_optimizer",
        trigger_source=(body.trigger_source if body else "defender_cron"),
        trigger_event=(body.trigger_event if body else "rate_opt"),
    )
    run.start()
    run.log("Rate optimizer pass", metadata={"phase": "start"})
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_executor, run_once)
        emit_run_details(run, "rate_optimizer", result)
        run.finish(success=True, summary=result.get("action", "done"), result=result)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/crash-oracle")
async def agents_crash_oracle(req: CrashOracleBody, request: Request):
    _check_agent_auth(request)
    from agents.test_default import crash_eth_oracle
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "portfolio_monitor",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "crash_oracle",
    )
    run.start()
    run.log(f"Crash ETH oracle to ${req.eth_price_usd}")
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor, partial(crash_eth_oracle, req.eth_price_usd)
        )
        run.finish(success=True, summary=f"ETH ${req.eth_price_usd}", result=result)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/health-warning")
async def agents_health_warning(req: LoanIdBody, request: Request):
    _check_agent_auth(request)
    from agents.test_default import emit_health_warning
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "portfolio_monitor",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "health_warning",
    )
    run.start()
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor, partial(emit_health_warning, req.loan_id)
        )
        run.log(f"Health warning loan #{req.loan_id} LTV={result.get('ltv_bps')}")
        run.finish(success=True, summary="health_warning", result=result)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/grace-start")
async def agents_grace_start(req: LoanIdBody, request: Request):
    _check_agent_auth(request)
    from agents.test_default import start_covenant_grace
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "portfolio_monitor",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "covenant_breach",
    )
    run.start()
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor, partial(start_covenant_grace, req.loan_id)
        )
        run.finish(success=True, summary="grace_started", result=result)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/grace-expire")
async def agents_grace_expire(req: LoanIdBody, request: Request):
    _check_agent_auth(request)
    from agents.test_default import force_expire_grace
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "portfolio_monitor",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "grace_expire_test",
    )
    run.start()
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor, partial(force_expire_grace, req.loan_id)
        )
        run.finish(success=True, summary="grace_expired", result=result)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/unblacklist")
async def agents_unblacklist(req: WalletBody, request: Request):
    _check_agent_auth(request)
    from agents.test_default import unblacklist_wallet
    import asyncio
    from ml.scoring_api import _executor

    run = AgentRunLogger(
        "liquidation",
        wallet_address=req.wallet_address,
        trigger_source=req.trigger_source,
        trigger_event=req.trigger_event or "unblacklist_test",
    )
    run.start()
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor, partial(unblacklist_wallet, req.wallet_address)
        )
        from agents.liquidation_snapshot import clear_liquidation_snapshot

        clear_liquidation_snapshot(req.wallet_address)
        run.finish(success=True, summary=result.get("status", "done"), result=result)
        return {"run_id": run.run_id, **result}
    except Exception as exc:
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/runs")
async def agents_list_runs(
    request: Request,
    agent_id: Optional[str] = None,
    wallet: Optional[str] = None,
    limit: int = 20,
):
    _check_agent_auth(request)
    from agents.log_reader import list_runs_from_supabase

    runs = list_runs_from_supabase(
        wallet=wallet,
        agent_id=agent_id,
        limit=min(limit, 100),
    )
    return {"runs": runs, "source": "supabase"}


@router.get("/runs/{run_id}")
async def agents_get_run(run_id: str, request: Request):
    _check_agent_auth(request)
    from agents.log_reader import list_runs_from_supabase, logs_for_run

    runs = list_runs_from_supabase(limit=200)
    run = next((r for r in runs if r.get("id") == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    logs = logs_for_run(run_id)
    agent_id = run.get("agent_id")
    for line in logs:
        line["agent_id"] = agent_id
    return {"run": run, "logs": logs, "source": "supabase"}
