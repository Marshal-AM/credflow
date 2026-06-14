"""FastAPI scoring service — XGBoost + Sybil detection + optional Reclaim bank balance."""

import asyncio
import json
import logging
import os
import queue
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any, Callable, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ml.agent_handlers import router as agents_router

# override=False — keep live RECLAIM_CALLBACK_URL from serve-with-ngrok.js
load_dotenv(override=False)

LOG_LEVEL = os.environ.get("SCORING_API_LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
    force=True,
)

logger = logging.getLogger("credflow.scoring")

app = FastAPI(title="CredFlow Scoring API", version="0.5.0")
app.include_router(agents_router)
_executor = ThreadPoolExecutor(max_workers=4)

_frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_origin, "http://127.0.0.1:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScoreRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    require_reclaim: bool = False
    reclaim_session_id: Optional[str] = None
    reuse_verified_reclaim: bool = False
    floor_cred_score: Optional[int] = Field(None, ge=300, le=850)
    stored_balance_usd_cents: Optional[int] = Field(None, ge=0)
    stored_reclaim_proof_hash: Optional[str] = None


class UnderwriteRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    rescore: bool = False
    reclaim_session_id: Optional[str] = None
    score_snapshot: Optional[dict] = None


ScoreEventEmitter = Callable[[str, dict[str, Any]], None]


def _emit(emit: ScoreEventEmitter | None, event_type: str, data: dict[str, Any]) -> None:
    if emit is not None:
        emit(event_type, data)


def _configure_indexer_loggers() -> None:
    """Ensure indexer modules log to the same terminal as the API."""
    for name in (
        "indexer.spoke_pipeline",
        "indexer.morpho_pipeline",
        "indexer.robinhood_pipeline",
        "indexer.features_pipeline",
        "indexer.alchemy_pipeline",
        "indexer.collect_sources",
    ):
        logging.getLogger(name).setLevel(getattr(logging, LOG_LEVEL, logging.INFO))


def _reclaim_callback_url() -> str:
    """Callback path matches reclaim/balance.js: /receive-proof"""
    configured = os.environ.get("RECLAIM_CALLBACK_URL", "").strip().rstrip("/")
    if configured:
        if configured.endswith("/receive-proof"):
            return configured
        if configured.endswith("/reclaim/callback"):
            return configured.replace("/reclaim/callback", "/receive-proof")
        return f"{configured}/receive-proof"
    port = os.environ.get("SCORING_API_PORT", "8000")
    return f"http://localhost:{port}/receive-proof"


def _score_sync(
    wallet_address: str,
    *,
    reclaim_session_id: str | None = None,
    require_reclaim: bool = False,
    reuse_verified_reclaim: bool = False,
    floor_cred_score: int | None = None,
    stored_balance_usd_cents: int | None = None,
    stored_reclaim_proof_hash: str | None = None,
    emit: ScoreEventEmitter | None = None,
) -> dict:
    load_dotenv(override=False)
    _configure_indexer_loggers()

    from ml.reclaim_service import (
        create_session,
        get_pending_session_for_wallet,
        get_session,
        reclaim_enabled,
        session_to_payload,
    )
    from ml.score_engine import compute_on_chain_cred_score, default_prob_to_bps

    use_reclaim = require_reclaim and reclaim_enabled()

    def _awaiting(payload: dict) -> dict:
        _emit(emit, "awaiting_reclaim", payload)
        return payload

    if use_reclaim:
        if not reclaim_session_id:
            if reuse_verified_reclaim:
                from ml.reclaim_service import bind_wallet_to_pending_session

                verified = bind_wallet_to_pending_session(wallet_address)
                if verified:
                    reclaim_session_id = verified.session_id
                    logger.info(
                        "Reclaim reuse_verified_reclaim wallet=%s session=%s",
                        wallet_address,
                        reclaim_session_id,
                    )
                elif stored_balance_usd_cents is not None and stored_balance_usd_cents > 0:
                    logger.info(
                        "Reclaim reuse from stored profile balance_usd_cents=%s wallet=%s",
                        stored_balance_usd_cents,
                        wallet_address,
                    )
                else:
                    raise ValueError(
                        "No verified Reclaim session for this wallet — complete bank login first"
                    )
            else:
                pending = get_pending_session_for_wallet(wallet_address)
                if pending:
                    logger.info(
                        "Reclaim resuming pending session=%s wallet=%s",
                        pending.session_id,
                        wallet_address,
                    )
                    return _awaiting({
                        "status": "awaiting_reclaim",
                        "reclaim_url": pending.request_url,
                        "reclaim_status_url": pending.status_url,
                        "verification_mode": pending.verification_mode,
                        "reclaim_session_id": pending.session_id,
                        "wallet_address": wallet_address,
                        "message": "Complete bank verification via Reclaim portal",
                    })
                callback = _reclaim_callback_url()
                session = create_session(wallet_address, callback)
                logger.info("=" * 60)
                logger.info("RECLAIM STEP 1 — open this URL in your browser (portal mode):")
                logger.info("  %s", session.request_url)
                logger.info("Session ID: %s", session.session_id)
                logger.info("Wallet:     %s", wallet_address)
                logger.info("Callback:   %s", callback)
                logger.info("After bank login, POST /score again (same wallet + require_reclaim)")
                logger.info("=" * 60)
                return _awaiting({
                    "status": "awaiting_reclaim",
                    "reclaim_url": session.request_url,
                    "reclaim_status_url": session.status_url,
                    "verification_mode": session.verification_mode,
                    "reclaim_session_id": session.session_id,
                    "wallet_address": wallet_address,
                    "callback_url": callback,
                    "instructions": {
                        "step_1": "Open reclaim_url in your PC browser and log into your bank",
                        "step_2": "Wait for Reclaim callback (check GET /reclaim/session/{id})",
                        "step_3_postman": {
                            "method": "POST",
                            "url": "/score",
                            "body": {
                                "wallet_address": wallet_address,
                                "require_reclaim": True,
                                "reclaim_session_id": session.session_id,
                            },
                        },
                        "step_3_shortcut": (
                            "Or POST /score with reuse_verified_reclaim:true after callback"
                        ),
                    },
                })

        if reclaim_session_id:
            session = get_session(reclaim_session_id)
            if not session:
                raise ValueError(f"Unknown or expired Reclaim session: {reclaim_session_id}")
            if session.wallet_address != wallet_address.lower():
                raise ValueError("Reclaim session wallet mismatch")
            if session.status != "verified":
                return _awaiting({
                    "status": "awaiting_reclaim",
                    "reclaim_url": session.request_url,
                    "reclaim_session_id": session.session_id,
                    "wallet_address": wallet_address,
                    "message": "Complete bank verification via Reclaim, then POST /score again",
                    "instructions": {
                        "poll": f"GET /reclaim/session/{session.session_id}",
                        "then": "POST /score with require_reclaim:true and reclaim_session_id",
                    },
                })

    from indexer.alchemy_pipeline import get_wallet_state
    from indexer.chains import CREDFLOW_CHAINS, hub_chain, spoke_chains
    from indexer.collect_sources import collect_all_sources
    from indexer.features_pipeline import fetch_borrow_features, fetch_wallet_features
    from ml.feature_engineering import build_feature_vector
    from ml.ipfs_pinata import upload_shap_explanation
    from ml.model_breakdown import build_model_breakdown
    from ml.sub_scores import compute_borrow_sub_score, compute_wallet_sub_score
    from ml.sybil_detector import run_sybil_check
    from ml.train_model import score_wallet

    t0 = time.perf_counter()

    def step(name: str) -> float:
        elapsed = time.perf_counter() - t0
        logger.info("[%.1fs] %s", elapsed, name)
        return time.perf_counter()

    logger.info("=== SCORE START wallet=%s ===", wallet_address)
    step("imports loaded")
    _emit(emit, "step", {"id": "fetch", "status": "running", "label": "Fetching on-chain & borrow history"})

    from concurrent.futures import as_completed

    t_phase_a = time.perf_counter()
    futures = {
        _executor.submit(fetch_borrow_features, wallet_address): "borrow",
        _executor.submit(fetch_wallet_features, wallet_address): "wallet",
        _executor.submit(get_wallet_state, wallet_address): "alchemy",
    }
    borrow_features = {}
    wallet_features = {}
    alchemy_state = {}
    for fut in as_completed(futures):
        key = futures[fut]
        data = fut.result()
        if key == "borrow":
            borrow_features = data
        elif key == "wallet":
            wallet_features = data
        else:
            alchemy_state = data
    phase_a_ms = int((time.perf_counter() - t_phase_a) * 1000)
    logger.info(
        "  phase_a parallel fetch %sms | borrow=%s wallet_tx=%s alchemy_tx=%s",
        phase_a_ms,
        borrow_features.get("total_borrows"),
        wallet_features.get("tx_count"),
        alchemy_state.get("tx_count"),
    )
    _emit(
        emit,
        "fetch_result",
        {
            "phase_a_ms": phase_a_ms,
            "borrow_total": borrow_features.get("total_borrows"),
            "wallet_tx_count": wallet_features.get("tx_count"),
            "alchemy_tx_count": alchemy_state.get("tx_count"),
            "chains": alchemy_state.get("chains", []),
        },
    )
    _emit(emit, "step", {"id": "fetch", "status": "done", "label": "On-chain data loaded"})

    def _wallet_analysis_path() -> tuple[dict, dict, dict, dict, dict, dict]:
        _emit(
            emit,
            "step",
            {"id": "wallet_ml", "status": "running", "label": "Running ML credit model"},
        )
        t_w = time.perf_counter()
        source_data = collect_all_sources(wallet_address, borrow_features=borrow_features)
        from indexer.scoring_metrics import enrich_scoring_features

        w_feat, b_feat = enrich_scoring_features(
            wallet_features, borrow_features, alchemy_state
        )
        features = build_feature_vector(
            wallet_address=wallet_address,
            borrow_features=b_feat,
            wallet_features=w_feat,
            alchemy_state=alchemy_state,
        )
        result = score_wallet(features)
        ms = int((time.perf_counter() - t_w) * 1000)
        _emit(
            emit,
            "ml_result",
            {
                "cred_score": result.get("cred_score"),
                "default_probability": result.get("default_probability"),
                "wallet_analysis_ms": ms,
            },
        )
        _emit(emit, "step", {"id": "wallet_ml", "status": "done"})
        return result, features, source_data, w_feat, b_feat, {"wallet_analysis_ms": ms}

    def _sybil_path() -> tuple[dict, dict]:
        from ml.sybil_detector import resolve_sybil_risk_addresses
        from ml.sybil_graph import stream_wallet_graph

        t_s = time.perf_counter()
        risk_addresses = resolve_sybil_risk_addresses(wallet_address, alchemy_state)
        if risk_addresses:
            logger.info(
                "  sybil on-chain risk addresses: %s",
                ", ".join(sorted(risk_addresses)[:8])
                + ("…" if len(risk_addresses) > 8 else ""),
            )
        _emit(
            emit,
            "step",
            {"id": "sybil_graph", "status": "running", "label": "Mapping wallet neighborhood"},
        )
        for graph_event in stream_wallet_graph(
            wallet_address, alchemy_state, risk_addresses=risk_addresses
        ):
            if graph_event["type"] == "graph_node":
                _emit(emit, "graph_node", graph_event["node"])
            elif graph_event["type"] == "graph_edge":
                _emit(emit, "graph_edge", graph_event["edge"])
            elif graph_event["type"] == "graph_meta":
                _emit(emit, "graph_meta", graph_event["meta"])
        _emit(
            emit,
            "step",
            {"id": "sybil_rgcn", "status": "running", "label": "Running R-GCN sybil screening"},
        )
        sybil = run_sybil_check(
            wallet_address, alchemy_state, risk_addresses=risk_addresses
        )
        _emit(emit, "sybil_result", sybil)
        _emit(emit, "step", {"id": "sybil_graph", "status": "done"})
        _emit(emit, "step", {"id": "sybil_rgcn", "status": "done"})
        ms = int((time.perf_counter() - t_s) * 1000)
        return sybil, {"sybil_analysis_ms": ms}

    t_phase_b = time.perf_counter()
    wallet_future = _executor.submit(_wallet_analysis_path)
    sybil_future = _executor.submit(_sybil_path)
    result, features, source_data, wallet_features, borrow_features, wallet_timing = wallet_future.result()
    sybil, sybil_timing = sybil_future.result()
    phase_b_ms = int((time.perf_counter() - t_phase_b) * 1000)
    logger.info(
        "  phase_b parallel %sms | sybil_risk=%s method=%s cred_score=%s",
        phase_b_ms,
        sybil.get("sybil_risk"),
        sybil.get("method"),
        result.get("cred_score"),
    )
    step("wallet_analysis + sybil_check (parallel)")

    sub_scores = {
        "borrow_sub_score": compute_borrow_sub_score(borrow_features),
        "wallet_sub_score": compute_wallet_sub_score(features),
    }
    logger.info(
        "  sub_scores: borrow=%s wallet=%s",
        sub_scores["borrow_sub_score"],
        sub_scores["wallet_sub_score"],
    )
    _emit(emit, "sub_scores", sub_scores)

    sybil_risk = sybil.get("sybil_risk", "low")
    default_prob = float(result.get("default_probability", 0))
    default_prob_bps = default_prob_to_bps(default_prob)

    reclaim_data: dict = {}
    balance_usd_cents = 0
    on_chain_cred_score = result["cred_score"]

    if use_reclaim and reclaim_session_id:
        session = get_session(reclaim_session_id)
        if session and session.status == "verified":
            reclaim_data = session_to_payload(session)
            balance_usd_cents = int(session.balance_usd_cents or 0)
            on_chain_cred_score = compute_on_chain_cred_score(default_prob_bps, balance_usd_cents)
            logger.info(
                "  on_chain_score=%s (ml_default_bps=%s balance_usd_cents=%s)",
                on_chain_cred_score,
                default_prob_bps,
                balance_usd_cents,
            )
    elif (
        use_reclaim
        and reuse_verified_reclaim
        and stored_balance_usd_cents is not None
        and stored_balance_usd_cents > 0
    ):
        balance_usd_cents = int(stored_balance_usd_cents)
        on_chain_cred_score = compute_on_chain_cred_score(default_prob_bps, balance_usd_cents)
        reclaim_data = {
            "balance_usd_cents": balance_usd_cents,
            "reclaim_proof_hash": stored_reclaim_proof_hash,
            "source": "stored_profile",
        }
        if stored_reclaim_proof_hash:
            reclaim_data["reclaim_proof_hash"] = stored_reclaim_proof_hash
        logger.info(
            "  on_chain_score=%s from stored reclaim (ml_default_bps=%s balance_usd_cents=%s)",
            on_chain_cred_score,
            default_prob_bps,
            balance_usd_cents,
        )

    score_floored = False
    if floor_cred_score is not None and on_chain_cred_score < int(floor_cred_score):
        logger.info(
            "Applying score floor %s -> %s (ml_off_chain=%s)",
            on_chain_cred_score,
            floor_cred_score,
            result["cred_score"],
        )
        score_floored = True
        on_chain_cred_score = int(floor_cred_score)

    approved = on_chain_cred_score >= 500 and sybil_risk != "high"
    rejection_reason = None
    if not approved:
        rejection_reason = (
            "Sybil risk too high"
            if sybil_risk == "high"
            else f"CredScore {on_chain_cred_score} below minimum 500"
        )

    t = step("upload_shap_explanation (Pinata IPFS)")
    _emit(emit, "step", {"id": "shap", "status": "running", "label": "Uploading SHAP explanation"})
    shap_cid = upload_shap_explanation(result["shap_values"], wallet_address)
    logger.info("  shap_cid=%s", shap_cid)
    _emit(emit, "shap", {"cid": shap_cid})
    _emit(emit, "step", {"id": "shap", "status": "done"})

    step("build_model_breakdown")
    model_breakdown = build_model_breakdown(
        features=features,
        result=result,
        sybil=sybil,
        sub_scores=sub_scores,
        borrow_features=borrow_features,
        approved=approved,
        rejection_reason=rejection_reason,
    )

    if reclaim_data:
        model_breakdown["on_chain_scoring"] = {
            "default_prob_bps": default_prob_bps,
            "balance_usd_cents": balance_usd_cents,
            "ml_off_chain_cred_score": result["cred_score"],
            "on_chain_cred_score": on_chain_cred_score,
            "formula": "computeCredScore(defaultProbBps, balanceUsdCents) on CredScoreEngine",
            "reclaim": reclaim_data,
        }

    total_s = time.perf_counter() - t0
    logger.info(
        "=== SCORE DONE wallet=%s cred_score=%s on_chain=%s approved=%s total=%.1fs ===",
        wallet_address,
        result["cred_score"],
        on_chain_cred_score,
        approved,
        total_s,
    )

    final = {
        **result,
        **sub_scores,
        "status": "complete",
        "cred_score": on_chain_cred_score
        if (reclaim_data or floor_cred_score is not None)
        else result["cred_score"],
        "ml_cred_score": result["cred_score"],
        "on_chain_cred_score": on_chain_cred_score,
        "default_prob_bps": default_prob_bps,
        "balance_usd_cents": balance_usd_cents,
        "reclaim_proof_hash": reclaim_data.get("reclaim_proof_hash"),
        "reclaim": reclaim_data or None,
        "approved": approved,
        "sybil_risk": sybil_risk,
        "sybil_details": sybil,
        "shap_cid": shap_cid,
        "features_used": features,
        "source_data": source_data,
        "model_breakdown": model_breakdown,
        "merged_inputs": {
            "wallet_features": wallet_features,
            "borrow_features": borrow_features,
            "alchemy_state": alchemy_state,
        },
        "chains_queried": {
            "hub": hub_chain().key,
            "spokes": [c.key for c in spoke_chains()],
            "all_credflow_chains": [c.key for c in CREDFLOW_CHAINS],
        },
        "chain_activity": {
            "wallet_chains": sorted(
                set(wallet_features.get("chains_with_activity", []) + alchemy_state.get("chains", []))
            ),
            "borrow_chains": borrow_features.get("chains_with_borrows", []),
        },
        "rejection_reason": rejection_reason,
        "floor_cred_score": floor_cred_score,
        "score_floored": score_floored,
        "pipeline": {
            "sybil": sybil,
            "phase_a_fetch_ms": phase_a_ms,
            "phase_b_parallel_ms": phase_b_ms,
            **wallet_timing,
            **sybil_timing,
        },
    }
    from ml.sybil_graph import collect_wallet_graph

    final["wallet_graph"] = collect_wallet_graph(wallet_address, alchemy_state)
    _emit(
        emit,
        "score_summary",
        {
            "cred_score": final["cred_score"],
            "on_chain_cred_score": on_chain_cred_score,
            "sybil_risk": sybil_risk,
            "approved": approved,
            "rejection_reason": rejection_reason,
            "balance_usd_cents": balance_usd_cents,
        },
    )
    _emit(emit, "complete", final)
    return final


@app.on_event("startup")
async def startup_log_config():
    _configure_indexer_loggers()
    from ml.reclaim_service import reclaim_enabled

    logger.info("CredFlow Scoring API ready | log_level=%s", LOG_LEVEL)
    if reclaim_enabled():
        callback = _reclaim_callback_url()
        logger.info("Reclaim enabled | callback=%s", callback)
        if callback.startswith("http://localhost") or callback.startswith("http://127.0.0.1"):
            logger.warning(
                "RECLAIM callback is localhost — bank proof will not arrive unless you use "
                "npm run ml:serve (ngrok) or set RECLAIM_CALLBACK_URL to a public URL"
            )
        logger.info("Postman step 1: POST /score {\"wallet_address\":\"0x...\",\"require_reclaim\":true}")


@app.get("/health")
async def health():
    from pathlib import Path

    from ml.constants import EXPLAINER_PATH, FEATURE_COLUMNS, MODEL_PATH, SYBIL_MODEL_PATH
    from ml.reclaim_service import reclaim_enabled

    return {
        "status": "ok",
        "model_loaded": Path(MODEL_PATH).exists(),
        "explainer_loaded": Path(EXPLAINER_PATH).exists(),
        "sybil_model_loaded": Path(SYBIL_MODEL_PATH).exists(),
        "feature_count": len(FEATURE_COLUMNS),
        "reclaim_enabled": reclaim_enabled(),
    }


@app.post("/reclaim/reset")
async def reclaim_reset(req: ScoreRequest):
    """Clear stored Reclaim sessions for a wallet (used when resetting Supabase score cache)."""
    from ml.reclaim_service import clear_sessions_for_wallet

    removed = clear_sessions_for_wallet(req.wallet_address)
    return {"ok": True, "wallet_address": req.wallet_address.lower(), "sessions_removed": removed}


@app.get("/reclaim/session/{session_id}")
async def reclaim_session_status(session_id: str):
    """Poll Reclaim session status after opening reclaim_url on your phone."""
    from ml.reclaim_service import get_session, session_to_payload

    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    payload = session_to_payload(session)
    if session.status == "verified":
        payload["next_step"] = {
            "method": "POST",
            "url": "/score",
            "body": {
                "wallet_address": session.wallet_address,
                "require_reclaim": True,
                "reclaim_session_id": session.session_id,
            },
        }
    return payload


async def _handle_reclaim_proof(request: Request) -> Response:
    """Shared handler — mirrors reclaim/balance.js POST /receive-proof."""
    from ml.reclaim_service import process_proof_callback

    body = await request.body()
    raw = body.decode("utf-8", errors="replace")
    content_type = request.headers.get("content-type", "")
    logger.info(
        "Reclaim proof POST path=%s bytes=%s content-type=%s",
        request.url.path,
        len(body),
        content_type,
    )
    if not body:
        logger.error("Reclaim callback received empty body")
        raise HTTPException(status_code=400, detail="Empty callback body")
    try:
        loop = asyncio.get_event_loop()
        session = await loop.run_in_executor(
            _executor, partial(process_proof_callback, raw, None)
        )
        logger.info("=" * 60)
        logger.info("RECLAIM STEP 2 — bank proof verified")
        logger.info("  session=%s wallet=%s", session.session_id, session.wallet_address)
        logger.info("  balance_inr_paise=%s balance_usd_cents=%s", session.balance_inr_paise, session.balance_usd_cents)
        logger.info("POST /score to run wallet analysis + ML scoring:")
        logger.info(
            '  {"wallet_address":"%s","require_reclaim":true,"reclaim_session_id":"%s"}',
            session.wallet_address,
            session.session_id,
        )
        logger.info("=" * 60)
        # balance.js returns res.sendStatus(200) — Reclaim expects empty 200
        return Response(status_code=200)
    except Exception as exc:
        logger.exception("Reclaim callback failed body_preview=%s", raw[:500])
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/receive-proof")
@app.get("/reclaim/callback")
async def reclaim_callback_ping():
    """Health check — open ngrok URL + /receive-proof in a browser."""
    return {
        "ok": True,
        "message": "Reclaim callback endpoint reachable",
        "path": "/receive-proof",
    }


@app.post("/receive-proof")
@app.post("/reclaim/callback")
async def reclaim_receive_proof(request: Request):
    """Reclaim POSTs proof here — same as reclaim/balance.js /receive-proof."""
    return await _handle_reclaim_proof(request)


@app.post("/reclaim/error-callback")
async def reclaim_error_callback(request: Request):
    """Reclaim error/cancel callback — log for debugging."""
    body = await request.body()
    raw = body.decode("utf-8", errors="replace")
    logger.error("Reclaim error callback: %s", raw[:2000])
    return Response(status_code=200)


def _underwrite_sync(
    wallet_address: str,
    *,
    rescore: bool = False,
    reclaim_session_id: str | None = None,
    score_snapshot: dict | None = None,
) -> dict:
    from agents.base import CredFlowAgent
    from agents.underwriter_agent import underwrite_wallet

    agent = CredFlowAgent()
    return underwrite_wallet(
        agent,
        wallet_address,
        rescore=rescore,
        score_data=score_snapshot,
        reclaim_session_id=reclaim_session_id,
    )


@app.post("/underwrite")
async def underwrite_endpoint(req: UnderwriteRequest):
    logger.info("POST /underwrite wallet=%s rescore=%s", req.wallet_address, req.rescore)
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
        logger.info("POST /underwrite result action=%s", result.get("action"))
        if result.get("action") == "reject":
            raise HTTPException(status_code=400, detail=result)
        if result.get("action") == "skip":
            result["mint_status"] = "minted"
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Underwrite failed for wallet=%s", req.wallet_address)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/score")
async def score_wallet_endpoint(req: ScoreRequest):
    logger.info(
        "POST /score wallet=%s require_reclaim=%s session=%s",
        req.wallet_address,
        req.require_reclaim,
        req.reclaim_session_id,
    )
    try:
        loop = asyncio.get_event_loop()
        fn = partial(
            _score_sync,
            req.wallet_address,
            reclaim_session_id=req.reclaim_session_id,
            require_reclaim=req.require_reclaim,
            reuse_verified_reclaim=req.reuse_verified_reclaim,
            floor_cred_score=req.floor_cred_score,
            stored_balance_usd_cents=req.stored_balance_usd_cents,
            stored_reclaim_proof_hash=req.stored_reclaim_proof_hash,
        )
        result = await loop.run_in_executor(_executor, fn)
        if result.get("status") == "awaiting_reclaim":
            return result
        logger.info(
            "POST /score responding wallet=%s cred_score=%s",
            req.wallet_address,
            result.get("cred_score"),
        )
        return result
    except FileNotFoundError as exc:
        logger.error("Model not found: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Model not trained: {exc}. Run npm run ml:train first.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Scoring failed for wallet=%s", req.wallet_address)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/score/stream")
async def score_stream_endpoint(req: ScoreRequest):
    """Server-sent events stream for live CredScore calculation."""
    event_q: queue.Queue = queue.Queue()

    def emit(event_type: str, data: dict[str, Any]) -> None:
        event_q.put({"type": event_type, "data": data})

    async def generate():
        loop = asyncio.get_event_loop()
        fn = partial(
            _score_sync,
            req.wallet_address,
            reclaim_session_id=req.reclaim_session_id,
            require_reclaim=req.require_reclaim,
            reuse_verified_reclaim=req.reuse_verified_reclaim,
            floor_cred_score=req.floor_cred_score,
            stored_balance_usd_cents=req.stored_balance_usd_cents,
            stored_reclaim_proof_hash=req.stored_reclaim_proof_hash,
            emit=emit,
        )
        task = loop.run_in_executor(_executor, fn)
        terminal = {"complete", "error", "awaiting_reclaim"}

        while True:
            try:
                item = event_q.get_nowait()
            except queue.Empty:
                if task.done():
                    break
                await asyncio.sleep(0.15)
                continue

            yield f"data: {json.dumps(item, default=str)}\n\n"
            if item.get("type") in terminal:
                break

        while True:
            try:
                item = event_q.get_nowait()
            except queue.Empty:
                break
            yield f"data: {json.dumps(item, default=str)}\n\n"
            if item.get("type") in terminal:
                break

        if not task.done():
            await task

        exc = task.exception()
        if exc is not None:
            err = {"type": "error", "data": {"message": str(exc)}}
            yield f"data: {json.dumps(err)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


def main():
    import uvicorn

    host = os.environ.get("SCORING_API_HOST", "0.0.0.0")
    port = int(os.environ.get("SCORING_API_PORT", "8000"))
    logger.info("Starting uvicorn on %s:%s", host, port)
    uvicorn.run(
        "ml.scoring_api:app",
        host=host,
        port=port,
        reload=False,
        log_level=LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    main()
