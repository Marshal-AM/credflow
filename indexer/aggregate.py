"""Merge per-chain indexer payloads into unified feature inputs."""

from datetime import datetime
from typing import Iterable

from indexer.scoring_metrics import (
    active_months_last_6,
    aave_only_wallet_flag,
    burst_activity_flag,
    compute_aave_metrics,
    days_since_last_active,
    longest_inactive_gap_days,
    zero_repays_multiple_borrows_flag,
)

_PROTOCOL_PREFIXES = ("credflow", "aave", "morpho")
_PROTOCOL_COUNT_SUFFIXES = (
    "supply_count",
    "withdraw_count",
    "borrow_count",
    "repay_count",
    "liquidation_count",
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


def _multi_protocol_borrow_flag(protocol_counts: dict[str, int]) -> int:
    protocols_with_borrows = sum(1 for count in protocol_counts.values() if count > 0)
    return int(protocols_with_borrows >= 2)


def merge_borrow_features(per_chain: Iterable[dict]) -> dict:
    """Combine CredFlow hub + Aave spokes + Morpho (Base Sepolia) borrow history."""
    rows = [row for row in per_chain if row]
    if not rows:
        return {}

    merged: dict = {}
    protocol_borrow_totals: dict[str, int] = {}

    for prefix in _PROTOCOL_PREFIXES:
        protocol_borrow_totals[prefix] = 0
        for suffix in _PROTOCOL_COUNT_SUFFIXES:
            key = f"{prefix}_{suffix}"
            merged[key] = sum(int(row.get(key, 0) or 0) for row in rows)
        protocol_borrow_totals[prefix] = int(merged.get(f"{prefix}_borrow_count", 0) or 0)

    total_borrow = sum(protocol_borrow_totals.values())
    total_repay = sum(int(merged.get(f"{prefix}_repay_count", 0) or 0) for prefix in _PROTOCOL_PREFIXES)
    total_liquidations = sum(
        int(merged.get(f"{prefix}_liquidation_count", 0) or 0) for prefix in _PROTOCOL_PREFIXES
    )

    activity_rows = sorted(
        (row for chain in rows for row in (chain.get("activity_rows") or [])),
        key=lambda row: int(row.get("block", 0) or 0),
    )
    aggregate = compute_aave_metrics(activity_rows)

    merged.update(
        {
            "total_borrow_count": total_borrow,
            "total_repay_count": total_repay,
            "total_borrows": total_borrow,
            "on_time_repayments": total_repay,
            "repay_ratio": total_repay / total_borrow if total_borrow > 0 else 0.5,
            "avg_blocks_to_repay": aggregate["avg_blocks_to_repay"],
            "avg_loan_duration": aggregate["avg_loan_duration"],
            "collateral_withdraw_before_borrow_count": aggregate["collateral_withdraw_before_borrow_count"],
            "net_collateral_position": aggregate["net_collateral_position"],
            "borrow_diversity": aggregate["borrow_diversity"],
            "collateral_diversity": aggregate["collateral_diversity"],
            "partial_repay_count": aggregate["partial_repay_count"],
            "partial_repay_ratio": aggregate["partial_repay_ratio"],
            "has_been_liquidated": int(total_liquidations > 0),
            "liquidation_count": total_liquidations,
            "multi_protocol_borrow_flag": _multi_protocol_borrow_flag(protocol_borrow_totals),
            "zero_repays_multiple_borrows_flag": zero_repays_multiple_borrows_flag(
                total_borrow, total_repay
            ),
            "activity_rows": activity_rows,
            "chains_with_borrows": [
                row.get("chain")
                for row in rows
                if row.get("credflow_borrow_count")
                or row.get("aave_borrow_count")
                or row.get("morpho_borrow_count")
            ],
            "protocols_with_borrows": [
                prefix for prefix, count in protocol_borrow_totals.items() if count > 0
            ],
            "max_borrow_usd": max(
                [float(row.get("max_borrow_usd", 0) or 0) for row in rows],
                default=0.0,
            ),
        }
    )
    return merged
