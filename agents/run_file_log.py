"""Write each agent / score / API-hook run to JSON files for offline verification.

When `npm run agents:serve` starts, it opens a session under logs/agent-runs/sessions/.
The ML API and Next.js API routes write into the same session while it is active.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
LOG_ROOT = Path(os.environ.get("AGENT_RUN_LOG_DIR", ROOT / "logs" / "agent-runs"))
SESSION_POINTER = LOG_ROOT / "_current_session"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slug(value: str | None, fallback: str = "none") -> str:
    if not value:
        return fallback
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in value.lower())[:48]


def get_active_session_dir() -> Path | None:
    try:
        if not SESSION_POINTER.is_file():
            return None
        raw = SESSION_POINTER.read_text(encoding="utf-8").strip()
        if not raw:
            return None
        path = Path(raw)
        return path if path.is_dir() else None
    except OSError:
        return None


def _runs_dir(kind: str) -> Path:
    session = get_active_session_dir()
    base = session if session else LOG_ROOT / "no-session"
    folder = {
        "agent": "agent-runs",
        "score": "score-runs",
        "api_hook": "api-hooks",
    }.get(kind, kind)
    path = base / folder
    path.mkdir(parents=True, exist_ok=True)
    return path


def begin_session(label: str = "agents-serve") -> Path:
    """Start a new logging session (called by agents.scheduler on startup)."""
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    session_dir = LOG_ROOT / "sessions" / f"{stamp}-{_slug(label)}"
    session_dir.mkdir(parents=True, exist_ok=True)
    for sub in ("agent-runs", "score-runs", "api-hooks"):
        (session_dir / sub).mkdir(exist_ok=True)

    manifest = {
        "session_id": session_dir.name,
        "label": label,
        "started_at": _utc_now(),
        "ended_at": None,
        "log_root": str(LOG_ROOT),
        "session_dir": str(session_dir),
        "run_counts": {"agent": 0, "score": 0, "api_hook": 0},
    }
    _write_json(session_dir / "session.json", manifest)
    SESSION_POINTER.write_text(str(session_dir.resolve()), encoding="utf-8")
    logger.info("Agent run log session started: %s", session_dir)
    return session_dir


def end_session() -> None:
    """Mark session ended when agents:serve shuts down."""
    session = get_active_session_dir()
    if not session:
        return
    manifest_path = session / "session.json"
    manifest: dict[str, Any] = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    manifest["ended_at"] = _utc_now()
    _write_json(manifest_path, manifest)
    try:
        if SESSION_POINTER.is_file():
            current = SESSION_POINTER.read_text(encoding="utf-8").strip()
            if current == str(session.resolve()):
                SESSION_POINTER.unlink()
    except OSError as exc:
        logger.warning("Could not clear session pointer: %s", exc)
    logger.info("Agent run log session ended: %s", session)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def _bump_session_count(kind: str) -> None:
    session = get_active_session_dir()
    if not session:
        return
    manifest_path = session / "session.json"
    if not manifest_path.is_file():
        return
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        counts = manifest.setdefault("run_counts", {})
        counts[kind] = int(counts.get(kind, 0)) + 1
        _write_json(manifest_path, manifest)
    except (OSError, json.JSONDecodeError, ValueError):
        pass


def new_run_file_path(
    *,
    kind: str,
    run_id: str,
    name_parts: list[str],
) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    short_id = run_id.replace("-", "")[:8]
    slug = "_".join(_slug(p) for p in name_parts if p)
    filename = f"{stamp}_{slug}_{short_id}.json"
    return _runs_dir(kind) / filename


class RunFileWriter:
    """Incremental JSON run log (agent, score, or api_hook)."""

    def __init__(
        self,
        *,
        kind: str,
        run_id: str,
        name_parts: list[str],
        metadata: dict[str, Any],
    ) -> None:
        self.kind = kind
        self.run_id = run_id
        self.path = new_run_file_path(kind=kind, run_id=run_id, name_parts=name_parts)
        self._started = time.perf_counter()
        self._record: dict[str, Any] = {
            "run_id": run_id,
            "kind": kind,
            "started_at": _utc_now(),
            "finished_at": None,
            "status": "running",
            "duration_ms": None,
            "summary": None,
            "logs": [],
            **metadata,
        }
        self._flush()

    def log(self, message: str, level: str = "info", metadata: dict | None = None) -> None:
        entry: dict[str, Any] = {"at": _utc_now(), "level": level, "message": message}
        if metadata:
            entry["metadata"] = metadata
        self._record["logs"].append(entry)
        self._flush()

    def finish(
        self,
        *,
        success: bool,
        summary: str,
        result: dict | None = None,
        related_tx_hashes: list | None = None,
        error: str | None = None,
    ) -> Path:
        self._record["status"] = "success" if success else "failed"
        self._record["finished_at"] = _utc_now()
        self._record["duration_ms"] = int((time.perf_counter() - self._started) * 1000)
        self._record["summary"] = summary
        if result is not None:
            self._record["result"] = result
        if related_tx_hashes:
            self._record["related_tx_hashes"] = related_tx_hashes
        if error:
            self._record["error"] = error
        self._flush()
        _bump_session_count(self.kind)
        return self.path

    def _flush(self) -> None:
        try:
            _write_json(self.path, self._record)
        except OSError as exc:
            logger.warning("Failed to write run log %s: %s", self.path, exc)


def write_score_run(
    *,
    wallet_address: str,
    require_reclaim: bool,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> Path | None:
    run_id = str(uuid.uuid4())
    writer = RunFileWriter(
        kind="score",
        run_id=run_id,
        name_parts=["score", wallet_address[:10], status],
        metadata={
            "wallet_address": wallet_address.lower(),
            "require_reclaim": require_reclaim,
            "score_status": status,
        },
    )
    writer.log(f"POST /score wallet={wallet_address} require_reclaim={require_reclaim}")
    if error:
        writer.finish(success=False, summary=error, error=error)
    else:
        cred = (result or {}).get("cred_score")
        writer.log(f"cred_score={cred} status={status}")
        writer.finish(
            success=status == "complete",
            summary=f"status={status} cred_score={cred}",
            result=result,
        )
    return writer.path


def write_api_hook_run(
    *,
    hook: str,
    wallet_address: str,
    chain_key: str | None = None,
    steps: list[dict[str, Any]] | None = None,
    success: bool,
    summary: str,
    payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> Path | None:
    run_id = str(uuid.uuid4())
    writer = RunFileWriter(
        kind="api_hook",
        run_id=run_id,
        name_parts=[hook, chain_key or "all", wallet_address[:10]],
        metadata={
            "hook": hook,
            "wallet_address": wallet_address.lower(),
            "chain_key": chain_key,
        },
    )
    writer.log(f"API hook {hook} wallet={wallet_address} chain={chain_key or 'n/a'}")
    for step in steps or []:
        name = step.get("step", "step")
        ok = step.get("ok", True)
        writer.log(f"{name}: {'ok' if ok else 'failed'}", level="info" if ok else "error", metadata=step)
    writer.finish(
        success=success,
        summary=summary,
        result=payload,
        error=error,
    )
    return writer.path
