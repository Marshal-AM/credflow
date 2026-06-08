"""Derive credit-scoring metrics from raw wallet + Aave activity (see docs/factors.md)."""

from __future__ import annotations

import os
from datetime import datetime, timezone

from indexer.chains import load_hub_addresses

_BORROW_TRANSFER_BLOCK_WINDOW = 50


def active_months_last_6(timestamps: list[float], now: float | None = None) -> int:
    """Count distinct calendar months with activity in the last 180 days."""
    if not timestamps:
        return 0
    now = now or datetime.now(timezone.utc).timestamp()
    cutoff = now - 180 * 86400
    months: set[tuple[int, int]] = set()
    for ts in timestamps:
        if ts >= cutoff:
            dt = datetime.utcfromtimestamp(ts)
            months.add((dt.year, dt.month))
    return len(months)


def longest_inactive_gap_days(timestamps: list[float]) -> float:
    if len(timestamps) < 2:
        return 0.0
    ordered = sorted(timestamps)
    return max((b - a) / 86400 for a, b in zip(ordered, ordered[1:]))


def days_since_last_active(timestamps: list[float], now: float | None = None) -> float:
    if not timestamps:
        return 0.0
    now = now or datetime.now(timezone.utc).timestamp()
    return max(0.0, (now - max(timestamps)) / 86400)


def burst_activity_flag(timestamps: list[float], threshold: float = 0.5, window_days: int = 7) -> int:
    """True when most activity sits inside a single short window (bot / fabricated history)."""
    if len(timestamps) < 3:
        return 0
    ordered = sorted(timestamps)
    window = window_days * 86400
    max_in_window = 0
    for i, start in enumerate(ordered):
        end = start + window
        count = sum(1 for t in ordered[i:] if t <= end)
        max_in_window = max(max_in_window, count)
    return int(max_in_window / len(ordered) >= threshold)


def known_lending_contracts() -> set[str]:
    from indexer.morpho_pipeline import MORPHO_BLUE
    from indexer.spoke_pipeline import SPOKE_AAVE_POOLS

    contracts = {v.lower() for v in SPOKE_AAVE_POOLS.values()}
    contracts.add(MORPHO_BLUE.lower())
    lending = os.environ.get("CREDFLOW_LENDING_ADDRESS") or load_hub_addresses().get("lending", "")
    if lending:
        contracts.add(str(lending).lower())
    return contracts


def aave_only_wallet_flag(unique_contracts: set[str] | list[str]) -> int:
    """Wallet only touched lending pool contracts — thin / suspicious profile."""
    normalized = {c.lower() for c in unique_contracts if c}
    if not normalized:
        return 0
    lending = known_lending_contracts()
    non_lending = normalized - lending
    return int(len(non_lending) == 0)


def zero_repays_multiple_borrows_flag(borrow_count: int, repay_count: int) -> int:
    return int(borrow_count >= 2 and repay_count == 0)


def _transfer_block_num(transfer: dict) -> int:
    raw = transfer.get("blockNum") or transfer.get("block") or 0
    if isinstance(raw, str):
        return int(raw, 16) if raw.startswith("0x") else int(raw or 0)
    return int(raw or 0)


def borrow_then_transfer_out_count(borrow_rows: list[dict], transfers: list[dict]) -> int:
    """Outbound transfer shortly after a borrow (extractive behaviour)."""
    if not borrow_rows or not transfers:
        return 0
    hits = 0
    for borrow in borrow_rows:
        if borrow.get("action") != "Borrow":
            continue
        borrow_block = int(borrow.get("block", 0) or 0)
        if not borrow_block:
            continue
        for transfer in transfers:
            if transfer.get("category") not in ("external", "erc20", None):
                continue
            block = _transfer_block_num(transfer)
            if borrow_block < block <= borrow_block + _BORROW_TRANSFER_BLOCK_WINDOW:
                hits += 1
                break
    return hits


def compute_aave_metrics(rows: list[dict]) -> dict:
    """Count-based Aave / lending activity metrics (testnet — no USD weighting)."""
    supplies = [r for r in rows if r.get("action") == "Supply"]
    withdraws = [r for r in rows if r.get("action") == "Withdraw"]
    borrows = [r for r in rows if r.get("action") == "Borrow"]
    repays = [r for r in rows if r.get("action") == "Repay"]
    liquidations = [r for r in rows if r.get("action") == "Liquidation"]

    block_gaps: list[int] = []
    partial_repay_count = 0
    sorted_borrows = sorted(borrows, key=lambda r: r.get("block", 0))

    for i, borrow in enumerate(sorted_borrows):
        borrow_block = int(borrow.get("block", 0) or 0)
        next_borrow_block = (
            int(sorted_borrows[i + 1].get("block", 0) or 0) if i + 1 < len(sorted_borrows) else 2**62
        )
        matching_repays = [
            r
            for r in repays
            if borrow_block <= int(r.get("block", 0) or 0) < next_borrow_block
        ]
        if len(matching_repays) > 1:
            partial_repay_count += 1
        if matching_repays:
            block_gaps.append(int(matching_repays[0]["block"]) - borrow_block)

    withdraw_before_borrow = 0
    for borrow in borrows:
        if any(w.get("block", 0) < borrow.get("block", 0) for w in withdraws):
            withdraw_before_borrow += 1

    durations_days: list[float] = []
    for borrow in borrows:
        matching = next((r for r in repays if r.get("block", 0) >= borrow.get("block", 0)), None)
        if matching and borrow.get("timestamp") and matching.get("timestamp"):
            durations_days.append((matching["timestamp"] - borrow["timestamp"]) / 86400)

    borrow_count = len(borrows)
    repay_count = len(repays)
    supply_count = len(supplies)
    withdraw_count = len(withdraws)
    liquidation_count = len(liquidations)

    return {
        "aave_supply_count": supply_count,
        "aave_withdraw_count": withdraw_count,
        "aave_borrow_count": borrow_count,
        "aave_repay_count": repay_count,
        "aave_liquidation_count": liquidation_count,
        "repay_ratio": repay_count / borrow_count if borrow_count > 0 else 0.5,
        "avg_blocks_to_repay": sum(block_gaps) / len(block_gaps) if block_gaps else 0.0,
        "avg_loan_duration": sum(durations_days) / len(durations_days) if durations_days else 0.0,
        "collateral_withdraw_before_borrow_count": withdraw_before_borrow,
        "net_collateral_position": max(0, supply_count - withdraw_count),
        "borrow_diversity": len({r.get("asset") for r in borrows if r.get("asset")}),
        "collateral_diversity": len({r.get("asset") for r in supplies if r.get("asset")}),
        "partial_repay_count": partial_repay_count,
        "partial_repay_ratio": partial_repay_count / borrow_count if borrow_count > 0 else 0.0,
        "has_been_liquidated": int(liquidation_count > 0),
        "zero_repays_multiple_borrows_flag": zero_repays_multiple_borrows_flag(borrow_count, repay_count),
        "total_borrows": borrow_count,
        "on_time_repayments": repay_count,
        "liquidation_count": liquidation_count,
    }


def compute_protocol_metrics(rows: list[dict], prefix: str) -> dict:
    """Map activity rows to protocol-prefixed lending counts (credflow_, aave_, morpho_)."""
    base = compute_aave_metrics(rows)
    return {
        f"{prefix}_supply_count": base["aave_supply_count"],
        f"{prefix}_withdraw_count": base["aave_withdraw_count"],
        f"{prefix}_borrow_count": base["aave_borrow_count"],
        f"{prefix}_repay_count": base["aave_repay_count"],
        f"{prefix}_liquidation_count": base["aave_liquidation_count"],
    }


def hub_lending_metrics(created: int, repaid: int, liquidated: int, avg_duration: float) -> dict:
    """Map CredFlow hub LoanCreated/Repaid events into credflow_* counts."""
    rows = (
        [{"action": "Borrow"}] * created
        + [{"action": "Repay"}] * repaid
        + [{"action": "Liquidation"}] * liquidated
    )
    metrics = compute_protocol_metrics(rows, "credflow")
    if avg_duration:
        metrics["avg_loan_duration"] = avg_duration
    return metrics


def wallet_activity_metrics(timestamps: list[float], unique_contracts: list[str]) -> dict:
    """Wallet-level timing + red-flag flags."""
    now = datetime.now(timezone.utc).timestamp()
    return {
        "days_since_last_active": days_since_last_active(timestamps, now),
        "longest_inactive_gap_days": longest_inactive_gap_days(timestamps),
        "burst_activity_flag": burst_activity_flag(timestamps),
        "aave_only_wallet_flag": aave_only_wallet_flag(unique_contracts),
    }


def enrich_scoring_features(
    wallet_features: dict,
    borrow_features: dict,
    alchemy_state: dict,
) -> tuple[dict, dict]:
    """Cross-source flags (wallet + borrow + Alchemy transfers)."""
    wallet = dict(wallet_features)
    borrow = dict(borrow_features)

    timestamps = list(wallet.get("transfer_timestamps") or [])
    if wallet.get("wallet_last_active"):
        try:
            timestamps.append(
                datetime.fromisoformat(
                    str(wallet["wallet_last_active"]).replace("Z", "+00:00")
                ).timestamp()
            )
        except ValueError:
            pass

    contracts = wallet.get("unique_contract_addresses") or []
    wallet.update(wallet_activity_metrics(timestamps, contracts))

    activity_rows = borrow.get("activity_rows") or []
    transfers = alchemy_state.get("recent_transactions") or []
    borrow["borrow_then_transfer_out_count"] = borrow_then_transfer_out_count(activity_rows, transfers)
    borrow["borrow_then_transfer_out_flag"] = int(borrow["borrow_then_transfer_out_count"] > 0)

    borrow_count = int(
        borrow.get("total_borrow_count", borrow.get("total_borrows", borrow.get("aave_borrow_count", 0))) or 0
    )
    repay_count = int(
        borrow.get("total_repay_count", borrow.get("on_time_repayments", borrow.get("aave_repay_count", 0))) or 0
    )
    borrow["zero_repays_multiple_borrows_flag"] = zero_repays_multiple_borrows_flag(
        borrow_count, repay_count
    )

    return wallet, borrow
