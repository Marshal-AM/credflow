"""Tests for sub-score computation."""

from ml.sub_scores import borrow_sub_score_parts, compute_borrow_sub_score, compute_wallet_sub_score


def test_borrow_sub_score_from_borrow_features():
    score = compute_borrow_sub_score(
        {
            "total_borrow_count": 3,
            "total_repay_count": 3,
            "repay_ratio": 1.0,
            "liquidation_count": 0,
            "avg_loan_duration": 28.0,
        }
    )
    assert score >= 70


def test_open_credflow_loan_penalty():
    parts = borrow_sub_score_parts(
        {
            "credflow_borrow_count": 1,
            "credflow_repay_count": 0,
            "total_borrow_count": 1,
            "total_repay_count": 0,
            "repay_ratio": 0.0,
        }
    )
    assert parts["open_credflow_penalty"] == -15


def test_response5_like_borrow_sub_score_range():
    score = compute_borrow_sub_score(
        {
            "credflow_borrow_count": 1,
            "credflow_repay_count": 0,
            "aave_borrow_count": 2,
            "aave_repay_count": 2,
            "morpho_borrow_count": 3,
            "morpho_repay_count": 2,
            "total_borrow_count": 6,
            "total_repay_count": 4,
            "repay_ratio": 0.6666666666666666,
            "collateral_withdraw_before_borrow_count": 3,
            "multi_protocol_borrow_flag": 1,
            "liquidation_count": 0,
            "avg_loan_duration": 0.03,
        }
    )
    assert 20 <= score <= 55


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
