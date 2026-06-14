"""Expand agent run results into structured Supabase log lines."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agents.run_logger import AgentRunLogger


def _log_txs(run: AgentRunLogger, hub_tx_hashes: list[dict] | None, *, prefix: str = "") -> None:
    for tx in hub_tx_hashes or []:
        if not isinstance(tx, dict):
            continue
        run.log(
            f"{prefix}lz eid={tx.get('eid')} chain={tx.get('chain_key', '?')} "
            f"type={tx.get('type', '?')} tx={tx.get('tx_hash')}",
            metadata={"phase": "tx", **tx},
        )


def emit_portfolio_monitor_details(run: AgentRunLogger, results: list[dict]) -> None:
    chains_seen: dict[str, int] = {}
    for item in results:
        if item.get("status") == "error" and "chain" in item:
            run.log(
                f"chain={item['chain']} scan failed: {item.get('error')}",
                level="error",
                metadata={"phase": "error", **item},
            )
            continue

        chain = str(item.get("chain", "?"))
        chains_seen[chain] = chains_seen.get(chain, 0) + 1
        loan_id = item.get("loan_id")
        ltv = item.get("ltv_bps")
        level = "warn" if item.get("health_warning_tx") or item.get("overdue") else "info"
        groq = item.get("groq") or {}

        msg = (
            f"chain={chain} loan=#{loan_id} ltv={ltv}bps "
            f"overdue={item.get('overdue', False)}"
        )
        if item.get("health_warning_tx"):
            msg += f" health_warning_tx={item['health_warning_tx']}"
        if item.get("grace"):
            msg += f" grace={item['grace']}"
        if groq.get("flag_liquidation"):
            msg += " groq_flag_liquidation=true"

        run.log(msg, level=level, metadata={"phase": "loan_scan", **item})

        if groq.get("reasoning"):
            run.log(
                f"  Groq: severity={groq.get('severity')} escalate={groq.get('escalate')} — "
                f"{str(groq.get('reasoning', ''))[:140]}",
                metadata={"phase": "groq", "loan_id": loan_id, "groq": groq},
            )

        if liq := item.get("liquidation"):
            run.log(
                f"  liquidation triggered loan=#{loan_id} status={liq.get('status')}",
                level="warn",
                metadata={"phase": "liquidation", **liq},
            )
            if liq.get("liquidate_tx"):
                run.log(
                    f"    liquidate tx={liq['liquidate_tx']}",
                    metadata={"phase": "tx", "tx_hash": liq["liquidate_tx"]},
                )

    if not chains_seen:
        run.log("No active loans on monitored chains", metadata={"phase": "scan", "loan_count": 0})
    else:
        for chain, count in sorted(chains_seen.items()):
            run.log(
                f"chain={chain} summary: {count} active loan(s) scanned",
                metadata={"phase": "chain_summary", "chain": chain, "loan_count": count},
            )


def emit_rate_optimizer_details(run: AgentRunLogger, result: dict) -> None:
    groq = result.get("groq") or {}
    run.log(
        f"pool util={result.get('utilization_bps')}bps "
        f"rate {result.get('current_base_rate')}→{result.get('proposed_base_rate')}bps "
        f"action={result.get('action')}",
        metadata={
            "phase": "rate_decision",
            "utilization_bps": result.get("utilization_bps"),
            "current_base_rate": result.get("current_base_rate"),
            "proposed_base_rate": result.get("proposed_base_rate"),
            "action": result.get("action"),
        },
    )
    if groq:
        run.log(
            f"Groq: {groq.get('direction')} {groq.get('adjust_bps')}bps — "
            f"{str(groq.get('reasoning', ''))[:140]}",
            metadata={"phase": "groq", "groq": groq},
        )
    if result.get("tx"):
        run.log(
            f"setBaseRate tx={result['tx']}",
            metadata={"phase": "tx", "tx_hash": result["tx"]},
        )


def emit_crosschain_sync_details(run: AgentRunLogger, results: list[dict]) -> None:
    if not results:
        run.log("No score or loan events to sync", metadata={"phase": "complete", "item_count": 0})
        return

    score_ops = sum(1 for i in results if i.get("type") == "score" or "score" in i and i.get("type") != "loan_active")
    loan_ops = sum(1 for i in results if i.get("type") in ("loan_active", "repaid"))
    run.log(
        f"Batch: {len(results)} operation(s) (score={score_ops}, loan={loan_ops})",
        metadata={"phase": "batch_summary", "item_count": len(results)},
    )

    for item in results:
        typ = item.get("type", "score")
        wallet = item.get("wallet", "?")
        score = item.get("score")
        score_part = f" score={score}" if score is not None else ""
        run.log(
            f"sync {typ} wallet={wallet}{score_part}",
            metadata={"phase": "sync_item", **item},
        )
        _log_txs(run, item.get("hub_tx_hashes"), prefix="  ")


def emit_underwriter_details(run: AgentRunLogger, result: dict) -> None:
    run.log(
        f"decision action={result.get('action')} cred_score={result.get('cred_score')} "
        f"sybil={result.get('sybil_risk', 'n/a')} ml={result.get('ml_cred_score', 'n/a')}",
        metadata={
            "phase": "decision",
            "action": result.get("action"),
            "cred_score": result.get("cred_score"),
            "sybil_risk": result.get("sybil_risk"),
        },
    )
    if result.get("reason"):
        run.log(
            f"reason: {result['reason']}",
            metadata={"phase": "decision", "reason": result["reason"]},
        )
    if groq := result.get("groq"):
        run.log(
            f"Groq: {groq.get('action')} conf={groq.get('confidence')} — "
            f"{str(groq.get('reasoning', ''))[:140]}",
            metadata={"phase": "groq", "groq": groq},
        )
    for field in ("default_prob_bps", "borrow_sub_score", "wallet_sub_score", "shap_cid"):
        if result.get(field) is not None:
            run.log(
                f"score components {field}={result[field]}",
                metadata={"phase": "score_components", field: result[field]},
            )
    if result.get("tx"):
        run.log(
            f"{result.get('onchain', 'onchain')} tx={result['tx']}",
            metadata={"phase": "tx", "tx_hash": result["tx"], "onchain": result.get("onchain")},
        )


def emit_liquidation_details(run: AgentRunLogger, result: dict) -> None:
    run.log(
        f"status={result.get('status')} loan=#{result.get('loan_id')} "
        f"borrower={result.get('borrower', 'n/a')}",
        metadata={"phase": "result", "status": result.get("status"), "loan_id": result.get("loan_id")},
    )
    if result.get("liquidate_tx"):
        run.log(
            f"liquidate tx={result['liquidate_tx']}",
            metadata={"phase": "tx", "tx_hash": result["liquidate_tx"]},
        )
    if result.get("blacklist_tx"):
        run.log(
            f"blacklist tx={result['blacklist_tx']}",
            metadata={"phase": "tx", "tx_hash": result["blacklist_tx"]},
        )
    if blacklisted := result.get("blacklisted"):
        run.log(
            f"blacklisted {len(blacklisted)} linked wallet(s): {', '.join(blacklisted[:3])}"
            f"{'…' if len(blacklisted) > 3 else ''}",
            metadata={"phase": "blacklist", "wallets": blacklisted},
        )
    lz = result.get("lz_broadcast_tx")
    if isinstance(lz, list):
        _log_txs(run, lz, prefix="  ")
    elif isinstance(lz, str) and lz:
        run.log(f"lz default broadcast tx={lz}", metadata={"phase": "tx", "tx_hash": lz})
    if groq := result.get("groq"):
        run.log(
            f"Groq blacklist: proceed={groq.get('proceed')} — "
            f"{str(groq.get('reasoning', ''))[:140]}",
            metadata={"phase": "groq", "groq": groq},
        )
    if warnings := result.get("health_warnings"):
        run.log(
            f"emitted {len(warnings)} health warning(s) on linked loans",
            metadata={"phase": "health_warnings", "warnings": warnings},
        )


def emit_run_details(run: AgentRunLogger, agent_id: str, result: dict | list | None) -> None:
    if agent_id == "portfolio_monitor" and isinstance(result, list):
        emit_portfolio_monitor_details(run, result)
    elif agent_id == "rate_optimizer" and isinstance(result, dict):
        emit_rate_optimizer_details(run, result)
    elif agent_id == "crosschain_sync" and isinstance(result, list):
        emit_crosschain_sync_details(run, result)
    elif agent_id == "underwriter" and isinstance(result, dict):
        emit_underwriter_details(run, result)
    elif agent_id == "liquidation" and isinstance(result, dict):
        emit_liquidation_details(run, result)
