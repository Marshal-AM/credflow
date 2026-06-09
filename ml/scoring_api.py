"""FastAPI scoring service — XGBoost + Sybil detection + optional Reclaim bank balance."""

import asyncio
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

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
_executor = ThreadPoolExecutor(max_workers=4)


class ScoreRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    require_reclaim: bool = False
    reclaim_session_id: Optional[str] = None


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
) -> dict:
    load_dotenv(override=False)
    _configure_indexer_loggers()

    from ml.reclaim_service import (
        bind_wallet_to_pending_session,
        create_session,
        get_session,
        reclaim_enabled,
        session_to_payload,
    )
    from ml.score_engine import compute_on_chain_cred_score, default_prob_to_bps

    use_reclaim = require_reclaim and reclaim_enabled()

    if use_reclaim:
        if not reclaim_session_id:
            verified = bind_wallet_to_pending_session(wallet_address)
            if verified:
                reclaim_session_id = verified.session_id
                logger.info(
                    "Reclaim already verified for wallet=%s session=%s — running full score",
                    wallet_address,
                    reclaim_session_id,
                )
            else:
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
                return {
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
                        "step_3_shortcut": "Or POST /score with only wallet_address + require_reclaim:true after callback",
                    },
                }

        session = get_session(reclaim_session_id)
        if not session:
            raise ValueError(f"Unknown or expired Reclaim session: {reclaim_session_id}")
        if session.wallet_address != wallet_address.lower():
            raise ValueError("Reclaim session wallet mismatch")
        if session.status != "verified":
            return {
                "status": "awaiting_reclaim",
                "reclaim_url": session.request_url,
                "reclaim_session_id": session.session_id,
                "wallet_address": wallet_address,
                "message": "Complete bank verification via Reclaim, then POST /score again",
                "instructions": {
                    "poll": f"GET /reclaim/session/{session.session_id}",
                    "then": "POST /score with require_reclaim:true and reclaim_session_id",
                },
            }

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

    t = step("fetch_borrow_features (CredFlow hub + Aave spokes + Morpho Base Sepolia)")
    borrow_features = fetch_borrow_features(wallet_address)
    logger.info(
        "  borrow: total_borrows=%s chains=%s",
        borrow_features.get("total_borrows"),
        borrow_features.get("chains_with_borrows"),
    )

    t = step("fetch_wallet_features (hub + spoke RPC)")
    wallet_features = fetch_wallet_features(wallet_address)
    logger.info(
        "  wallet: tx_count=%s chains=%s",
        wallet_features.get("tx_count"),
        wallet_features.get("chains_with_activity"),
    )

    t = step("get_wallet_state (Alchemy/RPC all chains)")
    alchemy_state = get_wallet_state(wallet_address)
    logger.info(
        "  alchemy: tx_count=%s eth_wei=%s recent_txs=%s",
        alchemy_state.get("tx_count"),
        alchemy_state.get("eth_balance_wei"),
        len(alchemy_state.get("recent_transactions", [])),
    )

    t = step("collect_all_sources (transparency payload)")
    source_data = collect_all_sources(wallet_address, borrow_features=borrow_features)
    summary = source_data.get("summary", {})
    logger.info(
        "  sources: %s active / %s total (skipped=%s)",
        summary.get("sources_with_data"),
        summary.get("total_sources"),
        summary.get("sources_skipped"),
    )

    t = step("enrich_scoring_features (red flags + activity timing)")
    from indexer.scoring_metrics import enrich_scoring_features

    wallet_features, borrow_features = enrich_scoring_features(
        wallet_features, borrow_features, alchemy_state
    )

    t = step("build_feature_vector")
    features = build_feature_vector(
        wallet_address=wallet_address,
        borrow_features=borrow_features,
        wallet_features=wallet_features,
        alchemy_state=alchemy_state,
    )

    t = step("run_sybil_check")
    sybil = run_sybil_check(wallet_address, alchemy_state)
    logger.info("  sybil_risk=%s method=%s", sybil.get("sybil_risk"), sybil.get("method"))

    t = step("score_wallet (XGBoost + SHAP)")
    result = score_wallet(features)
    logger.info("  cred_score=%s default_prob=%s", result.get("cred_score"), result.get("default_probability"))

    sub_scores = {
        "borrow_sub_score": compute_borrow_sub_score(borrow_features),
        "wallet_sub_score": compute_wallet_sub_score(features),
    }
    logger.info(
        "  sub_scores: borrow=%s wallet=%s",
        sub_scores["borrow_sub_score"],
        sub_scores["wallet_sub_score"],
    )

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

    approved = on_chain_cred_score >= 500 and sybil_risk != "high"
    rejection_reason = None
    if not approved:
        rejection_reason = (
            "Sybil risk too high"
            if sybil_risk == "high"
            else f"CredScore {on_chain_cred_score} below minimum 500"
        )

    t = step("upload_shap_explanation (Pinata IPFS)")
    shap_cid = upload_shap_explanation(result["shap_values"], wallet_address)
    logger.info("  shap_cid=%s", shap_cid)

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

    return {
        **result,
        **sub_scores,
        "status": "complete",
        "cred_score": on_chain_cred_score if reclaim_data else result["cred_score"],
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
    }


@app.on_event("startup")
async def startup_log_config():
    _configure_indexer_loggers()
    from ml.reclaim_service import reclaim_enabled

    logger.info("CredFlow Scoring API ready | log_level=%s", LOG_LEVEL)
    if reclaim_enabled():
        logger.info("Reclaim enabled | callback=%s", _reclaim_callback_url())
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
