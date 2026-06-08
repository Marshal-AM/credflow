"""Tests for source-data sub-score computation."""

from ml.sub_scores import (
    compute_fhenix_sub_score,
    compute_gmx_sub_score,
    compute_wallet_sub_score,
)


def test_gmx_sub_score_from_module():
    assert compute_gmx_sub_score({"gmx_sub_score": 71}) == 71


def test_fhenix_sub_score_from_attestation():
    attestation = {
        "income_above_threshold": True,
        "balance_above_threshold": True,
        "repayment_history_clean": True,
        "account_age_years": 3,
    }
    assert compute_fhenix_sub_score(attestation) == 96


def test_wallet_sub_score_from_features():
    features = {
        "wallet_age_days": 730,
        "tx_count": 320,
        "protocol_diversity": 5,
        "repayment_rate": 1.0,
        "defi_liquidation_count": 0,
        "eth_balance": 1.5,
    }
    assert compute_wallet_sub_score(features) > 0
