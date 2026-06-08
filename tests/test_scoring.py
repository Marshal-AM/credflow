"""Tests for XGBoost scoring."""

from ml.constants import FEATURE_COLUMNS
from ml.train_model import score_wallet


def _full_features(**overrides) -> dict:
    base = {col: 0.0 for col in FEATURE_COLUMNS}
    base.update(
        {
            "wallet_age_days": 730,
            "tx_count": 450,
            "unique_contracts_interacted": 15,
            "active_months_last_6": 6,
            "eth_balance": 3.5,
            "credflow_borrow_count": 2,
            "credflow_repay_count": 2,
            "aave_supply_count": 5,
            "aave_borrow_count": 5,
            "aave_repay_count": 5,
            "morpho_borrow_count": 2,
            "morpho_repay_count": 2,
            "total_borrow_count": 9,
            "total_repay_count": 9,
            "repay_ratio": 1.0,
            "multi_protocol_borrow_flag": 1,
            "avg_loan_duration_days": 25,
            "collateral_diversity": 3,
            "borrow_diversity": 2,
        }
    )
    base.update(overrides)
    return base


def test_high_score_wallet():
    result = score_wallet(_full_features())
    assert result["cred_score"] >= 700, "High quality wallet should score 700+"
    assert "shap_values" in result


def test_new_user_minimal_history():
    result = score_wallet(
        _full_features(
            wallet_age_days=1,
            tx_count=2,
            wallet_age_flag=1,
            unique_contracts_interacted=0,
            active_months_last_6=1,
            eth_balance=0.1,
            repay_ratio=0.5,
        )
    )
    assert 300 <= result["cred_score"] <= 850
