"""Compute human-readable sub-scores from raw indexer data (not SHAP)."""

_PROTOCOL_PREFIXES = ("credflow", "aave", "morpho")


def _repay_ratio(borrow_features: dict) -> tuple[float, float]:
    borrow_count = float(
        borrow_features.get("total_borrow_count", borrow_features.get("total_borrows", 0)) or 0
    )
    repay_ratio = float(borrow_features.get("repay_ratio", 0) or 0)
    if repay_ratio == 0 and borrow_count > 0:
        repay_count = float(
            borrow_features.get("total_repay_count", borrow_features.get("on_time_repayments", 0)) or 0
        )
        repay_ratio = repay_count / borrow_count
    elif borrow_count == 0:
        repay_ratio = 0.5
    return borrow_count, repay_ratio


def borrow_sub_score_parts(borrow_features: dict) -> dict:
    """Break down borrow sub-score components for API transparency."""
    borrow_count, repay_ratio = _repay_ratio(borrow_features)

    liquidations = float(borrow_features.get("liquidation_count", 0) or 0)
    if not liquidations:
        liquidations = float(borrow_features.get("credflow_liquidation_count", 0) or 0) + float(
            borrow_features.get("aave_liquidation_count", 0) or 0
        )
    avg_duration = float(borrow_features.get("avg_loan_duration", 0) or 0)
    has_liquidated = int(borrow_features.get("has_been_liquidated", 0) or liquidations > 0)

    if repay_ratio >= 0.8:
        repayment_bonus = 20
        partial_repay_bonus = 0
    elif repay_ratio >= 0.5:
        repayment_bonus = 0
        partial_repay_bonus = int(10 * repay_ratio)
    else:
        repayment_bonus = 0
        partial_repay_bonus = 0

    credflow_borrow = float(borrow_features.get("credflow_borrow_count", 0) or 0)
    credflow_repay = float(borrow_features.get("credflow_repay_count", 0) or 0)
    open_credflow_penalty = -15 if credflow_borrow > credflow_repay else 0

    open_protocols = 0
    for prefix in _PROTOCOL_PREFIXES:
        protocol_borrow = float(borrow_features.get(f"{prefix}_borrow_count", 0) or 0)
        protocol_repay = float(borrow_features.get(f"{prefix}_repay_count", 0) or 0)
        if protocol_borrow > protocol_repay:
            open_protocols += 1
    open_debt_penalty = -min(24, open_protocols * 8)

    withdraw_count = float(borrow_features.get("collateral_withdraw_before_borrow_count", 0) or 0)
    scaled_withdraw_penalty = -min(20, int(withdraw_count * 5)) if withdraw_count > 0 else 0

    multi_protocol_bonus = 5 if int(borrow_features.get("multi_protocol_borrow_flag", 0) or 0) else 0

    zero_repay_penalty = -20 if int(borrow_features.get("zero_repays_multiple_borrows_flag", 0) or 0) else 0
    transfer_out_penalty = -15 if int(borrow_features.get("borrow_then_transfer_out_flag", 0) or 0) else 0

    return {
        "base": 40,
        "repayment_bonus": repayment_bonus,
        "partial_repay_bonus": partial_repay_bonus,
        "has_borrows_bonus": 15 if borrow_count > 0 else 0,
        "liquidation_penalty": int(-liquidations * 20),
        "liquidated_flag_penalty": -15 if has_liquidated else 0,
        "duration_bonus": min(15, int(avg_duration / 4)),
        "open_credflow_penalty": open_credflow_penalty,
        "open_debt_penalty": open_debt_penalty,
        "scaled_withdraw_penalty": scaled_withdraw_penalty,
        "multi_protocol_bonus": multi_protocol_bonus,
        "zero_repays_penalty": zero_repay_penalty,
        "transfer_out_penalty": transfer_out_penalty,
    }


def compute_borrow_sub_score(borrow_features: dict) -> int:
    parts = borrow_sub_score_parts(borrow_features)
    score = sum(parts.values())
    return max(0, min(100, int(round(score))))


def compute_wallet_sub_score(feature_vector: dict) -> int:
    score = 30.0

    wallet_age_days = float(feature_vector.get("wallet_age_days", 0) or 0)
    score += min(20, wallet_age_days / 36.5)
    tx_count = float(feature_vector.get("tx_count", 0) or 0)
    score += min(15, tx_count / 20)

    unique_contracts = float(
        feature_vector.get("unique_contracts_interacted", feature_vector.get("protocol_diversity", 0)) or 0
    )
    score += min(15, unique_contracts)

    active_months = float(feature_vector.get("active_months_last_6", 0) or 0)
    score += min(10, active_months * 2)

    repay_ratio = float(feature_vector.get("repay_ratio", 0.5) or 0.5)
    score += repay_ratio * 10

    liquidations = float(
        feature_vector.get("aave_liquidation_count", feature_vector.get("defi_liquidation_count", 0)) or 0
    )
    score -= liquidations * 20

    eth_balance = float(feature_vector.get("eth_balance", 0) or 0)
    score += min(10, eth_balance * 2)

    if feature_vector.get("wallet_age_flag"):
        score -= 15
    if feature_vector.get("burst_activity_flag"):
        score -= 10
    if feature_vector.get("aave_only_wallet_flag"):
        score -= 8
    days_since = float(feature_vector.get("days_since_last_active", 0) or 0)
    if days_since > 90:
        score -= min(10, days_since / 30)

    return max(0, min(100, int(round(score))))
