"""FastAPI scoring service — XGBoost + Sybil detection."""

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv(override=True)

logger = logging.getLogger(__name__)

app = FastAPI(title="CredFlow Scoring API", version="0.1.0")
_executor = ThreadPoolExecutor(max_workers=4)


class ScoreRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    fhenix_attestation: dict = Field(default_factory=dict)


def _score_sync(wallet_address: str, fhenix_attestation: dict) -> dict:
    load_dotenv(override=True)
    from indexer.alchemy_pipeline import get_wallet_state
    from indexer.chains import CREDFLOW_CHAINS, GMX_REPUTATION_CHAIN, hub_chain, spoke_chains
    from indexer.dune_pipeline import fetch_aave_features, fetch_wallet_features
    from indexer.gmx_module import fetch_gmx_history
    from ml.feature_engineering import build_feature_vector
    from ml.ipfs_pinata import upload_shap_explanation
    from ml.sub_scores import (
        compute_fhenix_sub_score,
        compute_gmx_sub_score,
        compute_wallet_sub_score,
    )
    from ml.sybil_detector import run_sybil_check
    from ml.train_model import score_wallet

    dune_aave = fetch_aave_features(wallet_address)
    dune_wallet = fetch_wallet_features(wallet_address)
    alchemy_state = get_wallet_state(wallet_address)
    gmx_data = fetch_gmx_history(wallet_address)

    features = build_feature_vector(
        wallet_address=wallet_address,
        dune_aave=dune_aave,
        dune_wallet=dune_wallet,
        alchemy_state=alchemy_state,
        gmx_data=gmx_data,
        fhenix_attestation=fhenix_attestation,
    )

    sybil = run_sybil_check(wallet_address, alchemy_state)
    result = score_wallet(features)

    sub_scores = {
        "gmx_sub_score": compute_gmx_sub_score(gmx_data),
        "fhenix_sub_score": compute_fhenix_sub_score(fhenix_attestation),
        "wallet_sub_score": compute_wallet_sub_score(features),
    }

    sybil_risk = sybil.get("sybil_risk", "low")
    approved = result["cred_score"] >= 500 and sybil_risk != "high"

    shap_cid = upload_shap_explanation(result["shap_values"], wallet_address)

    return {
        **result,
        **sub_scores,
        "approved": approved,
        "sybil_risk": sybil_risk,
        "sybil_details": sybil,
        "shap_cid": shap_cid,
        "features_used": features,
        "chains_queried": {
            "hub": hub_chain().key,
            "spokes": [c.key for c in spoke_chains()],
            "gmx_reputation": GMX_REPUTATION_CHAIN.key,
            "all_credflow_chains": [c.key for c in CREDFLOW_CHAINS],
        },
        "chain_activity": {
            "wallet_chains": sorted(
                set(dune_wallet.get("chains_with_activity", []) + alchemy_state.get("chains", []))
            ),
            "borrow_chains": dune_aave.get("chains_with_borrows", []),
            "gmx_chain": gmx_data.get("chain"),
        },
        "rejection_reason": None
        if approved
        else (
            "Sybil risk too high"
            if sybil_risk == "high"
            else f"CredScore {result['cred_score']} below minimum 500"
        ),
    }


@app.get("/health")
async def health():
    from pathlib import Path

    from ml.constants import EXPLAINER_PATH, MODEL_PATH

    return {
        "status": "ok",
        "model_loaded": Path(MODEL_PATH).exists(),
        "explainer_loaded": Path(EXPLAINER_PATH).exists(),
    }


@app.post("/score")
async def score_wallet_endpoint(req: ScoreRequest):
    try:
        loop = asyncio.get_event_loop()
        fn = partial(_score_sync, req.wallet_address, req.fhenix_attestation)
        result = await loop.run_in_executor(_executor, fn)
        return result
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Model not trained: {exc}. Run npm run ml:train first.",
        ) from exc
    except Exception as exc:
        logger.exception("Scoring failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def main():
    import uvicorn

    host = os.environ.get("SCORING_API_HOST", "0.0.0.0")
    port = int(os.environ.get("SCORING_API_PORT", "8000"))
    uvicorn.run("ml.scoring_api:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
