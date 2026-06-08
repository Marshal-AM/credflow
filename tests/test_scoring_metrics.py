"""Tests for docs/factors.md metric derivations."""

from indexer.scoring_metrics import (
    active_months_last_6,
    aave_only_wallet_flag,
    borrow_then_transfer_out_count,
    burst_activity_flag,
    compute_aave_metrics,
    compute_protocol_metrics,
    days_since_last_active,
    zero_repays_multiple_borrows_flag,
)


def test_compute_aave_metrics_from_activity_rows():
    rows = [
        {"action": "Supply", "block": 100, "asset": "0xweth"},
        {"action": "Supply", "block": 110, "asset": "0xusdc"},
        {"action": "Withdraw", "block": 120, "asset": "0xweth"},
        {"action": "Borrow", "block": 130, "asset": "0xusdc"},
        {"action": "Repay", "block": 200, "asset": "0xusdc"},
    ]
    m = compute_aave_metrics(rows)
    assert m["aave_supply_count"] == 2
    assert m["aave_borrow_count"] == 1
    assert m["repay_ratio"] == 1.0
    assert m["collateral_withdraw_before_borrow_count"] == 1
    assert m["zero_repays_multiple_borrows_flag"] == 0


def test_compute_protocol_metrics_prefixes_counts():
    rows = [
        {"action": "Supply", "block": 1},
        {"action": "Borrow", "block": 2},
        {"action": "Repay", "block": 3},
    ]
    morpho = compute_protocol_metrics(rows, "morpho")
    assert morpho["morpho_supply_count"] == 1
    assert morpho["morpho_borrow_count"] == 1
    assert morpho["morpho_repay_count"] == 1
    assert "aave_borrow_count" not in morpho


def test_partial_repay_detection():
    rows = [
        {"action": "Borrow", "block": 100},
        {"action": "Repay", "block": 110},
        {"action": "Repay", "block": 120},
    ]
    m = compute_aave_metrics(rows)
    assert m["partial_repay_count"] == 1
    assert m["partial_repay_ratio"] == 1.0


def test_active_months_last_6():
    now = 1_700_000_000.0
    timestamps = [now - 30 * 86400, now - 60 * 86400, now - 200 * 86400]
    assert active_months_last_6(timestamps, now=now) == 2


def test_burst_activity_flag():
    now = 1_000_000.0
    burst = [now + i * 3600 for i in range(10)]
    spread = [now + i * 30 * 86400 for i in range(10)]
    assert burst_activity_flag(burst) == 1
    assert burst_activity_flag(spread) == 0


def test_zero_repays_multiple_borrows_flag():
    assert zero_repays_multiple_borrows_flag(2, 0) == 1
    assert zero_repays_multiple_borrows_flag(1, 0) == 0


def test_borrow_then_transfer_out():
    borrows = [{"action": "Borrow", "block": 100, "hash": "0xabc"}]
    transfers = [{"blockNum": "0x82", "category": "erc20"}]
    assert borrow_then_transfer_out_count(borrows, transfers) == 1


def test_aave_only_wallet_flag():
    pool = "0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27"
    assert aave_only_wallet_flag([pool]) == 1
    assert aave_only_wallet_flag([pool, "0xdead"]) == 0


def test_days_since_last_active():
    now = 1_000_000.0
    assert days_since_last_active([now - 10 * 86400], now=now) == 10.0
