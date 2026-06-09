"""Persistent agent state (grace periods, dedupe, sync cursor)."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
GRACE_FILE = DATA_DIR / "liquidation_grace.json"
WARNINGS_FILE = DATA_DIR / "health_warnings.json"
SYNC_FILE = DATA_DIR / "sync_state.json"

GRACE_SECONDS = int(os.environ.get("LIQUIDATION_GRACE_HOURS", "48")) * 3600


def _ensure_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load(path: Path) -> dict[str, Any]:
    _ensure_dir()
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save(path: Path, data: dict[str, Any]) -> None:
    _ensure_dir()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def grace_state() -> dict[str, Any]:
    return _load(GRACE_FILE)


def start_grace(loan_id: int) -> None:
    data = grace_state()
    key = str(loan_id)
    if key not in data:
        data[key] = {"started_at": int(time.time()), "breach": "covenant_overdue"}
        _save(GRACE_FILE, data)


def grace_expired(loan_id: int) -> bool:
    entry = grace_state().get(str(loan_id))
    if not entry:
        return False
    return int(time.time()) >= entry["started_at"] + GRACE_SECONDS


def clear_grace(loan_id: int) -> None:
    data = grace_state()
    data.pop(str(loan_id), None)
    _save(GRACE_FILE, data)


def warnings_state() -> dict[str, Any]:
    return _load(WARNINGS_FILE)


def should_emit_warning(loan_id: int, ltv_bps: int, cooldown_sec: int = 3600) -> bool:
    data = warnings_state()
    key = str(loan_id)
    prev = data.get(key)
    now = int(time.time())
    if prev and now - prev.get("at", 0) < cooldown_sec and prev.get("ltv") == ltv_bps:
        return False
    return True


def record_warning(loan_id: int, ltv_bps: int) -> None:
    data = warnings_state()
    data[str(loan_id)] = {"at": int(time.time()), "ltv": ltv_bps}
    _save(WARNINGS_FILE, data)


def last_sync_block(default: int | None = None) -> int:
    data = _load(SYNC_FILE)
    return int(data.get("last_sync_block", default or 0))


def save_sync_block(block: int) -> None:
    _save(SYNC_FILE, {"last_sync_block": block})
