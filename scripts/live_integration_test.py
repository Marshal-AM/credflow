"""Live integration smoke test for Phase 2 data pipelines."""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

WALLET = os.environ.get("AGENT_WALLET_ADDRESS", "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844")
FHENIX = {
    "income_above_threshold": True,
    "balance_above_threshold": True,
    "repayment_history_clean": True,
    "account_age_years": 3,
}


def status(name: str, data: dict, error: str | None = None) -> dict:
    row = {"source": name, "ok": error is None and bool(data), "data": data}
    if error:
        row["error"] = error
    return row


def main() -> int:
    os.environ["USE_MOCK_DATA"] = "0"
    results = []

    print(f"Wallet: {WALLET}")
    print(f"USE_MOCK_DATA={os.environ.get('USE_MOCK_DATA')}")
    print("-" * 60)

    try:
        from indexer.dune_pipeline import fetch_aave_features, fetch_wallet_features

        aave = fetch_aave_features(WALLET)
        results.append(status("dune_aave", aave, None if aave else "empty result"))
        wallet = fetch_wallet_features(WALLET)
        results.append(status("dune_wallet", wallet, None if wallet else "empty result"))
    except Exception as exc:
        results.append(status("dune", {}, str(exc)))

    try:
        from indexer.gmx_module import fetch_gmx_history

        gmx = fetch_gmx_history(WALLET)
        results.append(status("gmx", gmx))
    except Exception as exc:
        results.append(status("gmx", {}, str(exc)))

    try:
        from indexer.alchemy_pipeline import get_wallet_state

        alchemy = get_wallet_state(WALLET)
        results.append(
            status(
                "alchemy",
                {
                    "eth_balance_wei": alchemy.get("eth_balance_wei"),
                    "tx_count": alchemy.get("tx_count"),
                    "recent_tx_count": len(alchemy.get("recent_transactions", [])),
                },
            )
        )
    except Exception as exc:
        results.append(status("alchemy", {}, str(exc)))

    from ml.sub_scores import compute_fhenix_sub_score

    fhenix_score = compute_fhenix_sub_score(FHENIX)
    results.append(
        status(
            "fhenix_attestation",
            {"attestation": FHENIX, "fhenix_sub_score": fhenix_score},
        )
    )

    try:
        from indexer.alchemy_pipeline import get_wallet_state
        from indexer.dune_pipeline import fetch_aave_features, fetch_wallet_features
        from indexer.gmx_module import fetch_gmx_history
        from ml.feature_engineering import build_feature_vector
        from ml.ipfs_pinata import upload_shap_explanation
        from ml.sub_scores import (
            compute_fhenix_sub_score,
            compute_gmx_sub_score,
            compute_wallet_sub_score,
        )
        from ml.train_model import score_wallet

        dune_aave = fetch_aave_features(WALLET)
        dune_wallet = fetch_wallet_features(WALLET)
        alchemy_state = get_wallet_state(WALLET)
        gmx_data = fetch_gmx_history(WALLET)

        features = build_feature_vector(
            wallet_address=WALLET,
            dune_aave=dune_aave,
            dune_wallet=dune_wallet,
            alchemy_state=alchemy_state,
            gmx_data=gmx_data,
            fhenix_attestation=FHENIX,
        )
        scored = score_wallet(features)
        cid = upload_shap_explanation(scored["shap_values"], WALLET)

        results.append(
            status(
                "full_score",
                {
                    "cred_score": scored["cred_score"],
                    "default_probability": scored["default_probability"],
                    "gmx_sub_score": compute_gmx_sub_score(gmx_data),
                    "fhenix_sub_score": compute_fhenix_sub_score(FHENIX),
                    "wallet_sub_score": compute_wallet_sub_score(features),
                    "shap_cid": cid,
                    "feature_highlights": {
                        "wallet_age_days": features["wallet_age_days"],
                        "tx_count": features["tx_count"],
                        "eth_balance": features["eth_balance"],
                        "gmx_sub_score": features["gmx_sub_score"],
                        "has_gmx_history": features["has_gmx_history"],
                    },
                },
            )
        )
    except Exception as exc:
        results.append(status("full_score", {}, str(exc)))

    print(json.dumps(results, indent=2, default=str))
    ok_count = sum(1 for r in results if r.get("ok"))
    print("-" * 60)
    print(f"Sources reporting data: {ok_count}/{len(results)}")
    return 0 if ok_count >= 3 else 1


if __name__ == "__main__":
    raise SystemExit(main())
