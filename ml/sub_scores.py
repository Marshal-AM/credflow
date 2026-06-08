"""Compute human-readable sub-scores from raw indexer data (not SHAP)."""


def compute_gmx_sub_score(gmx_data: dict) -> int:
    return int(gmx_data.get("gmx_sub_score", 50) or 50)


def compute_fhenix_sub_score(attestation: dict) -> int:
    score = 40
    if attestation.get("income_above_threshold"):
        score += 15
    if attestation.get("balance_above_threshold"):
        score += 15
    if attestation.get("repayment_history_clean"):
        score += 20
    years = float(attestation.get("account_age_years", 0) or 0)
    score += min(10, int(years * 2))
    return max(0, min(100, score))


def compute_wallet_sub_score(feature_vector: dict) -> int:
    score = 30.0

    wallet_age_days = float(feature_vector.get("wallet_age_days", 0) or 0)
    score += min(20, wallet_age_days / 36.5)

    tx_count = float(feature_vector.get("tx_count", 0) or 0)
    score += min(15, tx_count / 20)

    protocol_diversity = float(feature_vector.get("protocol_diversity", 0) or 0)
    score += min(15, protocol_diversity * 2)

    repayment_rate = float(feature_vector.get("repayment_rate", 0.5) or 0.5)
    score += repayment_rate * 15

    liquidations = float(feature_vector.get("defi_liquidation_count", 0) or 0)
    score -= liquidations * 20

    eth_balance = float(feature_vector.get("eth_balance", 0) or 0)
    score += min(10, eth_balance * 2)

    return max(0, min(100, int(round(score))))
