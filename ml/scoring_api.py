"""FastAPI scoring service — XGBoost + Sybil detection."""

import asyncio
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv(override=True)

LOG_LEVEL = os.environ.get("SCORING_API_LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
    force=True,
)

logger = logging.getLogger("credflow.scoring")

app = FastAPI(title="CredFlow Scoring API", version="0.4.0")
_executor = ThreadPoolExecutor(max_workers=4)


class ScoreRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)


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


def _score_sync(wallet_address: str) -> dict:
    load_dotenv(override=False)
    _configure_indexer_loggers()

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
    approved = result["cred_score"] >= 500 and sybil_risk != "high"
    rejection_reason = None
    if not approved:
        rejection_reason = (
            "Sybil risk too high"
            if sybil_risk == "high"
            else f"CredScore {result['cred_score']} below minimum 500"
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

    total_s = time.perf_counter() - t0
    logger.info(
        "=== SCORE DONE wallet=%s cred_score=%s approved=%s total=%.1fs ===",
        wallet_address,
        result["cred_score"],
        approved,
        total_s,
    )

    return {
        **result,
        **sub_scores,
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
    logger.info("CredFlow Scoring API ready | log_level=%s", LOG_LEVEL)


@app.get("/health")
async def health():
    from pathlib import Path

    from ml.constants import EXPLAINER_PATH, FEATURE_COLUMNS, MODEL_PATH

    return {
        "status": "ok",
        "model_loaded": Path(MODEL_PATH).exists(),
        "explainer_loaded": Path(EXPLAINER_PATH).exists(),
        "feature_count": len(FEATURE_COLUMNS),
    }


@app.post("/score")
async def score_wallet_endpoint(req: ScoreRequest):
    logger.info("POST /score received wallet=%s", req.wallet_address)
    try:
        loop = asyncio.get_event_loop()
        fn = partial(_score_sync, req.wallet_address)
        result = await loop.run_in_executor(_executor, fn)
        logger.info("POST /score responding wallet=%s cred_score=%s", req.wallet_address, result.get("cred_score"))
        return result
    except FileNotFoundError as exc:
        logger.error("Model not found: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Model not trained: {exc}. Run npm run ml:train first.",
        ) from exc
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
