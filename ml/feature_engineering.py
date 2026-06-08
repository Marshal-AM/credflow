"""Combine indexer outputs into the XGBoost feature vector."""

from datetime import datetime

import pandas as pd

from ml.constants import FEATURE_COLUMNS


def build_feature_vector(
    wallet_address: str,
    dune_aave: dict,
    dune_wallet: dict,
    alchemy_state: dict,
    gmx_data: dict,
    fhenix_attestation: dict,
) -> dict:
    """Build feature dict matching training schema. Missing fields default to safe zeros."""
    _ = wallet_address
    now = datetime.utcnow().timestamp()

    first_seen = dune_wallet.get("wallet_first_seen")
    wallet_age_days = 0.0
    if first_seen:
        try:
            wallet_age_days = (now - pd.Timestamp(first_seen).timestamp()) / 86400
        except (ValueError, TypeError):
            wallet_age_days = 0.0

    total_borrows = float(dune_aave.get("total_borrows", 0) or 0)
    on_time = float(dune_aave.get("on_time_repayments", 0) or 0)
    repayment_rate = on_time / total_borrows if total_borrows > 0 else 0.5
    liquidation_count = float(dune_aave.get("liquidation_count", 0) or 0)

    eth_balance = int(alchemy_state.get("eth_balance_wei", 0) or 0) / 1e18
    tx_count = float(alchemy_state.get("tx_count", dune_wallet.get("tx_count", 0)) or 0)
    protocol_diversity = float(dune_wallet.get("unique_protocols", 0) or 0)

    gmx_sub_score = float(gmx_data.get("gmx_sub_score", 50) or 50)
    gmx_liquidations = float(gmx_data.get("liquidation_count", 0) or 0)
    gmx_avg_leverage = float(gmx_data.get("avg_leverage", 0) or 0)
    gmx_total_positions = float(gmx_data.get("total_positions", 0) or 0)

    fhenix_income_verified = bool(fhenix_attestation.get("income_above_threshold", False))
    fhenix_balance_verified = bool(fhenix_attestation.get("balance_above_threshold", False))
    fhenix_repayment_clean = bool(fhenix_attestation.get("repayment_history_clean", False))
    fhenix_account_age_years = float(fhenix_attestation.get("account_age_years", 0) or 0)

    features = {
        "wallet_age_days": wallet_age_days,
        "tx_count": tx_count,
        "protocol_diversity": protocol_diversity,
        "total_borrows": total_borrows,
        "repayment_rate": repayment_rate,
        "defi_liquidation_count": liquidation_count,
        "avg_loan_duration_days": float(dune_aave.get("avg_loan_duration", 0) or 0),
        "eth_balance": eth_balance,
        "gmx_sub_score": gmx_sub_score,
        "gmx_liquidation_count": gmx_liquidations,
        "gmx_avg_leverage": gmx_avg_leverage,
        "gmx_total_positions": gmx_total_positions,
        "has_gmx_history": int(bool(gmx_data.get("has_gmx_history", False))),
        "fhenix_income_verified": int(fhenix_income_verified),
        "fhenix_balance_verified": int(fhenix_balance_verified),
        "fhenix_repayment_clean": int(fhenix_repayment_clean),
        "fhenix_account_age_years": fhenix_account_age_years,
    }

    for col in FEATURE_COLUMNS:
        features.setdefault(col, 0)

    return features
