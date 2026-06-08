"""Merge per-chain indexer payloads into unified feature inputs."""

from datetime import datetime
from typing import Iterable


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
    unique_protocols = sum(int(row.get("unique_protocols", 0) or 0) for row in rows)

    first_seen_ts = [
        ts
        for row in rows
        if (ts := _to_ts(row.get("wallet_first_seen"))) is not None
    ]
    last_active_ts = [
        ts
        for row in rows
        if (ts := _to_ts(row.get("wallet_last_active"))) is not None
    ]

    merged = {
        "tx_count": tx_count,
        "unique_protocols": unique_protocols,
        "chains_with_activity": [row.get("chain") for row in rows if row.get("tx_count")],
    }
    if first_seen_ts:
        merged["wallet_first_seen"] = datetime.utcfromtimestamp(min(first_seen_ts)).isoformat()
    if last_active_ts:
        merged["wallet_last_active"] = datetime.utcfromtimestamp(max(last_active_ts)).isoformat()
    return merged


def merge_borrow_features(per_chain: Iterable[dict]) -> dict:
    """Combine Aave / CredFlow borrow history across chains."""
    rows = [row for row in per_chain if row]
    if not rows:
        return {}

    total_borrows = sum(int(row.get("total_borrows", 0) or 0) for row in rows)
    on_time = sum(int(row.get("on_time_repayments", 0) or 0) for row in rows)
    liquidations = sum(int(row.get("liquidation_count", 0) or 0) for row in rows)

    durations = [
        float(row["avg_loan_duration"])
        for row in rows
        if row.get("avg_loan_duration") not in (None, "", 0, 0.0)
    ]
    max_borrow = max(
        [float(row.get("max_borrow_usd", 0) or 0) for row in rows],
        default=0.0,
    )

    merged = {
        "total_borrows": total_borrows,
        "on_time_repayments": on_time if on_time else total_borrows,
        "liquidation_count": liquidations,
        "max_borrow_usd": max_borrow,
        "avg_loan_duration": sum(durations) / len(durations) if durations else 0.0,
        "chains_with_borrows": [row.get("chain") for row in rows if row.get("total_borrows")],
    }
    return merged
