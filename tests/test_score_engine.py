"""Tests mirroring CredScoreEngine.sol formula."""

from ml.score_engine import balance_capacity_factor_bps, compute_on_chain_cred_score, default_prob_to_bps


def test_default_prob_to_bps():
    assert default_prob_to_bps(0.006) == 60
    assert default_prob_to_bps(1.0) == 10000


def test_balance_capacity_tiers():
    assert balance_capacity_factor_bps(5000) == 10000
    assert balance_capacity_factor_bps(10000) == 9800
    assert balance_capacity_factor_bps(150000) == 9600
    assert balance_capacity_factor_bps(600000) == 9200


def test_higher_balance_raises_score():
    low = compute_on_chain_cred_score(500, 5000)
    high = compute_on_chain_cred_score(500, 600000)
    assert high > low


def test_score_clamped():
    score = compute_on_chain_cred_score(0, 0)
    assert score == 850
    score_bad = compute_on_chain_cred_score(10000, 0)
    assert score_bad == 300
