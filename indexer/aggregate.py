"""Merge per-chain indexer payloads into unified feature inputs."""

from datetime import datetime
from typing import Iterable

from indexer.scoring_metrics import (
    active_months_last_6,
    aave_only_wallet_flag,
    burst_activity_flag,
    days_since_last_active,
    longest_inactive_gap_days,
)


def _to_ts(value) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return float(value)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def merge_wallet_features(per_chain: Iterable[dict]) -> dict:
    """Combine wallet stats across CredFlow chains."""
    rows = [row for row in per_chain if row]
    if not rows:
        return {}

    tx_count = sum(int(row.get("tx_count", 0) or 0) for row in rows)

    unique_contracts: set[str] = set()
    all_timestamps: list[float] = []
    for row in rows:
        unique_contracts.update(row.get("unique_contract_addresses") or [])
        if not row.get("unique_contract_addresses"):
            # fallback: per-chain count proxy
            n = int(row.get("unique_protocols", 0) or 0)
            if n:
                unique_contracts.update(f"{row.get('chain', 'unknown')}:{i}" for i in range(n))
        all_timestamps.extend(row.get("transfer_timestamps") or [])

    first_seen_ts = [
        ts for row in rows if (ts := _to_ts(row.get("wallet_first_seen"))) is not None
    ]
    last_active_ts = [
        ts for row in rows if (ts := _to_ts(row.get("wallet_last_active"))) is not None
    ]
    all_timestamps.extend(first_seen_ts)
    all_timestamps.extend(last_active_ts)

    contract_list = list(unique_contracts)
    merged = {
        "tx_count": tx_count,
        "unique_protocols": len(unique_contracts) if unique_contracts else sum(
            int(row.get("unique_protocols", 0) or 0) for row in rows
        ),
        "unique_contracts_interacted": len(unique_contracts) if unique_contracts else sum(
            int(row.get("unique_protocols", 0) or 0) for row in rows
        ),
        "unique_contract_addresses": contract_list,
        "transfer_timestamps": all_timestamps,
        "active_months_last_6": active_months_last_6(all_timestamps),
        "days_since_last_active": days_since_last_active(all_timestamps),
        "longest_inactive_gap_days": longest_inactive_gap_days(all_timestamps),
        "burst_activity_flag": burst_activity_flag(all_timestamps),
        "aave_only_wallet_flag": aave_only_wallet_flag(contract_list),
        "chains_with_activity": [row.get("chain") for row in rows if row.get("tx_count")],
    }
    if first_seen_ts:
        merged["wallet_first_seen"] = datetime.utcfromtimestamp(min(first_seen_ts)).isoformat()
    if last_active_ts:
        merged["wallet_last_active"] = datetime.utcfromtimestamp(max(last_active_ts)).isoformat()
    return merged


_AAVE_SUM_KEYS = [
    "aave_supply_count",
    "aave_withdraw_count",
    "aave_borrow_count",
    "aave_repay_count",
    "aave_liquidation_count",
    "collateral_withdraw_before_borrow_count",
    "net_collateral_position",
    "partial_repay_count",
    "borrow_then_transfer_out_count",
    "total_borrows",
    "on_time_repayments",
    "liquidation_count",
    "has_been_liquidated",
    "zero_repays_multiple_borrows_flag",
    "borrow_then_transfer_out_flag",
]

_AAVE_MAX_KEYS = ["borrow_diversity", "collateral_diversity", "partial_repay_ratio"]


def merge_borrow_features(per_chain: Iterable[dict]) -> dict:
    """Combine Aave / CredFlow borrow history across chains."""
    rows = [row for row in per_chain if row]
    if not rows:
        return {}

    merged: dict = {k: 0 for k in _AAVE_SUM_KEYS}
    for row in rows:
        for key in _AAVE_SUM_KEYS:
            merged[key] += int(row.get(key, 0) or 0)
        for key in _AAVE_MAX_KEYS:
            merged[key] = max(int(merged.get(key, 0) or 0), int(row.get(key, 0) or 0))

    borrow_count = merged["aave_borrow_count"] or merged["total_borrows"]
    repay_count = merged["aave_repay_count"] or merged["on_time_repayments"]
    merged["repay_ratio"] = repay_count / borrow_count if borrow_count > 0 else 0.5

    block_gaps = [float(row["avg_blocks_to_repay"]) for row in rows if row.get("avg_blocks_to_repay")]
    merged["avg_blocks_to_repay"] = sum(block_gaps) / len(block_gaps) if block_gaps else 0.0

    durations = [float(row["avg_loan_duration"]) for row in rows if row.get("avg_loan_duration")]
    merged["avg_loan_duration"] = sum(durations) / len(durations) if durations else 0.0

    merged["max_borrow_usd"] = max(
        [float(row.get("max_borrow_usd", 0) or 0) for row in rows],
        default=0.0,
    )
    merged["chains_with_borrows"] = [
        row.get("chain") for row in rows if row.get("aave_borrow_count") or row.get("total_borrows")
    ]
    merged["has_been_liquidated"] = int(merged["aave_liquidation_count"] > 0)
    merged["activity_rows"] = sorted(
        (row for chain in rows for row in (chain.get("activity_rows") or [])),
        key=lambda row: int(row.get("block", 0) or 0),
    )
    borrow_n = merged["aave_borrow_count"] or merged["total_borrows"]
    repay_n = merged["aave_repay_count"] or merged["on_time_repayments"]
    if not merged.get("zero_repays_multiple_borrows_flag"):
        from indexer.scoring_metrics import zero_repays_multiple_borrows_flag

        merged["zero_repays_multiple_borrows_flag"] = zero_repays_multiple_borrows_flag(
            borrow_n, repay_n
        )
    merged["partial_repay_ratio"] = (
        merged.get("partial_repay_ratio", 0)
        if merged.get("partial_repay_ratio")
        else (merged["partial_repay_count"] / borrow_n if borrow_n else 0.0)
    )
    return merged
