"""In-memory agent state (grace periods, dedupe, sync cursor)."""

from __future__ import annotations

import os
import time
from typing import Any

GRACE_SECONDS = int(os.environ.get("LIQUIDATION_GRACE_HOURS", "48")) * 3600

_grace: dict[str, Any] = {}
_warnings: dict[str, Any] = {}
_sync: dict[str, Any] = {}


def grace_state() -> dict[str, Any]:
    return dict(_grace)


def start_grace(loan_id: int) -> None:
    key = str(loan_id)
    if key not in _grace:
        _grace[key] = {"started_at": int(time.time()), "breach": "covenant_overdue"}


def grace_expired(loan_id: int) -> bool:
    entry = _grace.get(str(loan_id))
    if not entry:
        return False
    return int(time.time()) >= entry["started_at"] + GRACE_SECONDS


def clear_grace(loan_id: int) -> None:
    _grace.pop(str(loan_id), None)


def expire_grace_for_test(loan_id: int) -> None:
    """Test-only: treat grace as elapsed (user story day-31 liquidation path)."""
    _grace[str(loan_id)] = {
        "started_at": int(time.time()) - GRACE_SECONDS - 1,
        "breach": "covenant_overdue",
    }


def warnings_state() -> dict[str, Any]:
    return dict(_warnings)


def should_emit_warning(loan_id: int, ltv_bps: int, cooldown_sec: int = 3600) -> bool:
    key = str(loan_id)
    prev = _warnings.get(key)
    now = int(time.time())
    if prev and now - prev.get("at", 0) < cooldown_sec and prev.get("ltv") == ltv_bps:
        return False
    return True


def record_warning(loan_id: int, ltv_bps: int) -> None:
    _warnings[str(loan_id)] = {"at": int(time.time()), "ltv": ltv_bps}


def last_sync_block(default: int | None = None) -> int:
    return int(_sync.get("last_sync_block", default or 0))


def save_sync_block(block: int) -> None:
    _sync["last_sync_block"] = block
