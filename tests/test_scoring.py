"""Tests for XGBoost scoring."""

from ml.train_model import score_wallet


def test_high_score_wallet():
    features = {
        "wallet_age_days": 730,
        "tx_count": 450,
        "protocol_diversity": 8,
        "total_borrows": 5,
        "repayment_rate": 1.0,
        "defi_liquidation_count": 0,
        "avg_loan_duration_days": 25,
        "eth_balance": 3.5,
        "gmx_sub_score": 85,
        "gmx_liquidation_count": 0,
        "gmx_avg_leverage": 3.2,
        "gmx_total_positions": 40,
        "has_gmx_history": 1,
        "fhenix_income_verified": 1,
        "fhenix_balance_verified": 1,
        "fhenix_repayment_clean": 1,
        "fhenix_account_age_years": 4,
    }
    result = score_wallet(features)
    assert result["cred_score"] >= 700, "High quality wallet should score 700+"
    assert "shap_values" in result


def test_new_user_with_attestation():
    features = {
        "wallet_age_days": 1,
        "tx_count": 2,
        "protocol_diversity": 0,
        "total_borrows": 0,
        "repayment_rate": 0.5,
        "defi_liquidation_count": 0,
        "avg_loan_duration_days": 0,
        "eth_balance": 0.1,
        "gmx_sub_score": 50,
        "gmx_liquidation_count": 0,
        "gmx_avg_leverage": 0,
        "gmx_total_positions": 0,
        "has_gmx_history": 0,
        "fhenix_income_verified": 1,
        "fhenix_balance_verified": 1,
        "fhenix_repayment_clean": 1,
        "fhenix_account_age_years": 3,
    }
    result = score_wallet(features)
    assert result["cred_score"] >= 550, "New user with clean attestation should get access"
