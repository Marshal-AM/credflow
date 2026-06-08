"""Tests for sub-score computation."""

from ml.sub_scores import compute_borrow_sub_score, compute_wallet_sub_score


def test_borrow_sub_score_from_borrow_features():
    score = compute_borrow_sub_score(
        {
            "aave_borrow_count": 3,
            "aave_repay_count": 3,
            "repay_ratio": 1.0,
            "aave_liquidation_count": 0,
            "avg_loan_duration": 28.0,
        }
    )
    assert score >= 70


def test_wallet_sub_score_from_features():
    score = compute_wallet_sub_score(
        {
            "wallet_age_days": 365,
            "tx_count": 100,
            "unique_contracts_interacted": 5,
            "active_months_last_6": 4,
            "repay_ratio": 1.0,
            "aave_liquidation_count": 0,
            "eth_balance": 2.0,
        }
    )
    assert 50 <= score <= 100
