"""Compute human-readable sub-scores from raw indexer data (not SHAP)."""


def compute_borrow_sub_score(borrow_features: dict) -> int:
    borrow_count = float(borrow_features.get("aave_borrow_count", borrow_features.get("total_borrows", 0)) or 0)
    repay_ratio = float(borrow_features.get("repay_ratio", 0) or 0)
    if repay_ratio == 0 and borrow_count > 0:
        repay_count = float(borrow_features.get("aave_repay_count", borrow_features.get("on_time_repayments", 0)) or 0)
        repay_ratio = repay_count / borrow_count
    elif borrow_count == 0:
        repay_ratio = 0.5

    liquidations = float(
        borrow_features.get("aave_liquidation_count", borrow_features.get("liquidation_count", 0)) or 0
    )
    avg_duration = float(borrow_features.get("avg_loan_duration", 0) or 0)
    has_liquidated = int(borrow_features.get("has_been_liquidated", 0) or liquidations > 0)

    score = 40.0
    if repay_ratio >= 0.8:
        score += 20
    if borrow_count > 0:
        score += 15
    score -= liquidations * 20
    score -= has_liquidated * 15
    score += min(15, avg_duration / 4)
    if float(borrow_features.get("collateral_withdraw_before_borrow_count", 0) or 0) > 0:
        score -= 10
    if int(borrow_features.get("zero_repays_multiple_borrows_flag", 0) or 0):
        score -= 20
    if int(borrow_features.get("borrow_then_transfer_out_flag", 0) or 0):
        score -= 15
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

    liquidations = float(feature_vector.get("aave_liquidation_count", feature_vector.get("defi_liquidation_count", 0)) or 0)
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
