"""Read agent run JSON logs from logs/agent-runs for API responses (no Supabase)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agents.run_file_log import get_active_session_dir, LOG_ROOT


def _latest_session_dir() -> Path | None:
    sessions = LOG_ROOT / "sessions"
    if not sessions.is_dir():
        return None
    dirs = sorted(
        (p for p in sessions.iterdir() if p.is_dir()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return dirs[0] if dirs else None


def _session_dirs() -> list[Path]:
    dirs: list[Path] = []
    active = get_active_session_dir()
    if active:
        dirs.append(active)
    latest = _latest_session_dir()
    if latest and latest != active:
        dirs.append(latest)
    if not dirs:
        fallback = LOG_ROOT / "no-session"
        if fallback.is_dir():
            dirs.append(fallback)
    return dirs


def _agent_id_for(record: dict[str, Any]) -> str:
    if record.get("agent_id"):
        return str(record["agent_id"])
    if record.get("kind") == "score":
        return "scoring_api"
    if record.get("kind") == "api_hook":
        return f"api_hook:{record.get('hook', 'unknown')}"
    return "unknown"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def list_runs_from_files(
    *,
    wallet: str | None = None,
    agent_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    wallet_l = wallet.lower() if wallet else None
    collected: list[tuple[dict[str, Any], float]] = []

    for session in _session_dirs():
        for sub in ("agent-runs", "score-runs", "api-hooks"):
            folder = session / sub
            if not folder.is_dir():
                continue
            for path in folder.glob("*.json"):
                record = _read_json(path)
                if not record or not record.get("run_id"):
                    continue
                if wallet_l and record.get("wallet_address"):
                    if str(record["wallet_address"]).lower() != wallet_l:
                        continue
                aid = _agent_id_for(record)
                if agent_id and aid != agent_id and record.get("agent_id") != agent_id:
                    continue
                collected.append((record, path.stat().st_mtime))

    collected.sort(
        key=lambda item: item[0].get("started_at") or "",
        reverse=True,
    )

    runs: list[dict[str, Any]] = []
    for record, _ in collected[:limit]:
        runs.append(
            {
                "id": record["run_id"],
                "agent_id": _agent_id_for(record),
                "status": record.get("status", "unknown"),
                "trigger_source": record.get("trigger_source") or record.get("kind"),
                "trigger_event": record.get("trigger_event") or record.get("hook"),
                "started_at": record.get("started_at"),
                "finished_at": record.get("finished_at"),
                "summary": record.get("summary"),
                "wallet_address": record.get("wallet_address"),
                "kind": record.get("kind"),
            }
        )
    return runs


def logs_for_run(run_id: str) -> list[dict[str, Any]]:
    for session in _session_dirs():
        for sub in ("agent-runs", "score-runs", "api-hooks"):
            folder = session / sub
            if not folder.is_dir():
                continue
            for path in folder.glob("*.json"):
                record = _read_json(path)
                if not record or record.get("run_id") != run_id:
                    continue
                agent = _agent_id_for(record)
                lines = []
                for i, entry in enumerate(record.get("logs") or []):
                    lines.append(
                        {
                            "id": f"{run_id}-{i}",
                            "run_id": run_id,
                            "logged_at": entry.get("at"),
                            "level": entry.get("level", "info"),
                            "message": entry.get("message", ""),
                            "agent_id": agent,
                        }
                    )
                return lines
    return []
