"""Combine indexer outputs into the XGBoost feature vector."""

from datetime import datetime

import pandas as pd

from ml.constants import FEATURE_COLUMNS


def build_feature_vector(
    wallet_address: str,
    borrow_features: dict,
    wallet_features: dict,
    alchemy_state: dict,
) -> dict:
    """Build feature dict matching training schema (see docs/factors.md)."""
    _ = wallet_address
    now = datetime.utcnow().timestamp()

    first_seen = wallet_features.get("wallet_first_seen")
    wallet_age_days = 0.0
    if first_seen:
        try:
            wallet_age_days = (now - pd.Timestamp(first_seen).timestamp()) / 86400
        except (ValueError, TypeError):
            wallet_age_days = 0.0

    eth_balance = int(alchemy_state.get("eth_balance_wei", 0) or 0) / 1e18
    tx_count = float(alchemy_state.get("tx_count", wallet_features.get("tx_count", 0)) or 0)

    total_borrow = float(
        borrow_features.get("total_borrow_count", borrow_features.get("total_borrows", 0)) or 0
    )
    total_repay = float(
        borrow_features.get("total_repay_count", borrow_features.get("on_time_repayments", 0)) or 0
    )
    repay_ratio = float(borrow_features.get("repay_ratio", 0) or 0)
    if repay_ratio == 0 and total_borrow > 0:
        repay_ratio = total_repay / total_borrow
    elif total_borrow == 0:
        repay_ratio = 0.5

    features = {
        "wallet_age_days": wallet_age_days,
        "tx_count": tx_count,
        "unique_contracts_interacted": float(
            wallet_features.get("unique_contracts_interacted", wallet_features.get("unique_protocols", 0)) or 0
        ),
        "active_months_last_6": float(wallet_features.get("active_months_last_6", 0) or 0),
        "days_since_last_active": float(wallet_features.get("days_since_last_active", 0) or 0),
        "longest_inactive_gap_days": float(wallet_features.get("longest_inactive_gap_days", 0) or 0),
        "eth_balance": eth_balance,
        "credflow_borrow_count": float(borrow_features.get("credflow_borrow_count", 0) or 0),
        "credflow_repay_count": float(borrow_features.get("credflow_repay_count", 0) or 0),
        "credflow_liquidation_count": float(borrow_features.get("credflow_liquidation_count", 0) or 0),
        "aave_supply_count": float(borrow_features.get("aave_supply_count", 0) or 0),
        "aave_withdraw_count": float(borrow_features.get("aave_withdraw_count", 0) or 0),
        "aave_borrow_count": float(borrow_features.get("aave_borrow_count", 0) or 0),
        "aave_repay_count": float(borrow_features.get("aave_repay_count", 0) or 0),
        "aave_liquidation_count": float(
            borrow_features.get("aave_liquidation_count", borrow_features.get("liquidation_count", 0)) or 0
        ),
        "morpho_supply_count": float(borrow_features.get("morpho_supply_count", 0) or 0),
        "morpho_withdraw_count": float(borrow_features.get("morpho_withdraw_count", 0) or 0),
        "morpho_borrow_count": float(borrow_features.get("morpho_borrow_count", 0) or 0),
        "morpho_repay_count": float(borrow_features.get("morpho_repay_count", 0) or 0),
        "total_borrow_count": total_borrow,
        "total_repay_count": total_repay,
        "repay_ratio": repay_ratio,
        "avg_blocks_to_repay": float(borrow_features.get("avg_blocks_to_repay", 0) or 0),
        "avg_loan_duration_days": float(borrow_features.get("avg_loan_duration", 0) or 0),
        "collateral_withdraw_before_borrow_count": float(
            borrow_features.get("collateral_withdraw_before_borrow_count", 0) or 0
        ),
        "net_collateral_position": float(borrow_features.get("net_collateral_position", 0) or 0),
        "borrow_diversity": float(borrow_features.get("borrow_diversity", 0) or 0),
        "collateral_diversity": float(borrow_features.get("collateral_diversity", 0) or 0),
        "partial_repay_count": float(borrow_features.get("partial_repay_count", 0) or 0),
        "partial_repay_ratio": float(borrow_features.get("partial_repay_ratio", 0) or 0),
        "multi_protocol_borrow_flag": int(borrow_features.get("multi_protocol_borrow_flag", 0) or 0),
        "has_been_liquidated": int(
            borrow_features.get("has_been_liquidated", 0)
            or (borrow_features.get("credflow_liquidation_count", 0) or 0) > 0
            or (borrow_features.get("aave_liquidation_count", 0) or 0) > 0
        ),
        "wallet_age_flag": int(wallet_age_days < 7),
        "zero_repays_multiple_borrows_flag": int(
            borrow_features.get("zero_repays_multiple_borrows_flag", 0)
            or (total_borrow >= 2 and total_repay == 0)
        ),
        "burst_activity_flag": int(wallet_features.get("burst_activity_flag", 0) or 0),
        "aave_only_wallet_flag": int(wallet_features.get("aave_only_wallet_flag", 0) or 0),
        "borrow_then_transfer_out_flag": int(
            borrow_features.get("borrow_then_transfer_out_flag", 0)
            or (borrow_features.get("borrow_then_transfer_out_count", 0) or 0) > 0
        ),
    }

    for col in FEATURE_COLUMNS:
        features.setdefault(col, 0)

    return features
