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
        from indexer.features_pipeline import fetch_borrow_features, fetch_wallet_features

        borrow = fetch_borrow_features(WALLET)
        results.append(status("borrow_features", borrow, None if borrow else "empty result"))
        wallet = fetch_wallet_features(WALLET)
        results.append(status("wallet_features", wallet, None if wallet else "empty result"))
    except Exception as exc:
        results.append(status("features_pipeline", {}, str(exc)))

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

    try:
        from indexer.alchemy_pipeline import get_wallet_state
        from indexer.features_pipeline import fetch_borrow_features, fetch_wallet_features
        from ml.feature_engineering import build_feature_vector
        from ml.ipfs_pinata import upload_shap_explanation
        from ml.sub_scores import compute_borrow_sub_score, compute_wallet_sub_score
        from ml.train_model import score_wallet

        from indexer.scoring_metrics import enrich_scoring_features

        borrow_features = fetch_borrow_features(WALLET)
        wallet_features = fetch_wallet_features(WALLET)
        alchemy_state = get_wallet_state(WALLET)
        wallet_features, borrow_features = enrich_scoring_features(
            wallet_features, borrow_features, alchemy_state
        )
        features = build_feature_vector(
            wallet_address=WALLET,
            borrow_features=borrow_features,
            wallet_features=wallet_features,
            alchemy_state=alchemy_state,
        )
        score = score_wallet(features)
        shap_cid = upload_shap_explanation(score["shap_values"], WALLET)
        results.append(
            status(
                "full_score",
                {
                    "cred_score": score["cred_score"],
                    "borrow_sub_score": compute_borrow_sub_score(borrow_features),
                    "wallet_sub_score": compute_wallet_sub_score(features),
                    "wallet_age_days": features["wallet_age_days"],
                    "shap_cid": shap_cid,
                },
            )
        )
    except Exception as exc:
        results.append(status("full_score", {}, str(exc)))

    print(json.dumps(results, indent=2, default=str))
    failed = [r for r in results if not r.get("ok")]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
