"""Persist agent runs + log lines to Supabase."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextlib import contextmanager
from typing import Any, Generator

import httpx

logger = logging.getLogger(__name__)


def _supabase_config() -> tuple[str, str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for agent logging"
        )
    return url.rstrip("/"), key


def _headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


class AgentRunLogger:
    def __init__(
        self,
        agent_id: str,
        *,
        wallet_address: str | None = None,
        trigger_source: str = "manual",
        trigger_event: str | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.wallet_address = wallet_address.lower() if wallet_address else None
        self.trigger_source = trigger_source
        self.trigger_event = trigger_event
        self.run_id: str | None = None
        self._started = time.perf_counter()
        self._url, self._key = _supabase_config()

    def _post(self, table: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    f"{self._url}/rest/v1/{table}",
                    headers=_headers(self._key),
                    content=json.dumps(payload),
                )
                if resp.status_code >= 400:
                    logger.warning("Supabase %s insert failed: %s", table, resp.text[:300])
                    return None
                data = resp.json()
                return data[0] if isinstance(data, list) and data else data
        except Exception as exc:
            logger.warning("Supabase write failed: %s", exc)
            return None

    def start(self) -> str:
        self.run_id = str(uuid.uuid4())
        row = self._post(
            "agent_runs",
            {
                "id": self.run_id,
                "agent_id": self.agent_id,
                "wallet_address": self.wallet_address,
                "trigger_source": self.trigger_source,
                "trigger_event": self.trigger_event,
                "status": "running",
            },
        )
        if row and row.get("id"):
            self.run_id = str(row["id"])
        self.log(
            f"Started {self.agent_id} source={self.trigger_source} event={self.trigger_event}"
        )
        return self.run_id

    def log(self, message: str, level: str = "info", metadata: dict | None = None) -> None:
        logger.info("[%s] %s", self.agent_id, message)
        if not self.run_id:
            return
        payload: dict[str, Any] = {
            "run_id": self.run_id,
            "level": level,
            "message": message,
        }
        if metadata:
            payload["metadata"] = metadata
        self._post("agent_log_lines", payload)

    def finish(
        self,
        *,
        success: bool,
        summary: str,
        result: dict | None = None,
        related_tx_hashes: list | None = None,
        error: str | None = None,
    ) -> None:
        if not self.run_id:
            return
        duration_ms = int((time.perf_counter() - self._started) * 1000)
        payload: dict[str, Any] = {
            "status": "success" if success else "failed",
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "duration_ms": duration_ms,
            "summary": summary,
            "result": result,
            "related_tx_hashes": related_tx_hashes or [],
        }
        if error:
            payload["result"] = {**(result or {}), "error": error}
        try:
            with httpx.Client(timeout=15.0) as client:
                client.patch(
                    f"{self._url}/rest/v1/agent_runs?id=eq.{self.run_id}",
                    headers=_headers(self._key),
                    content=json.dumps(payload),
                )
        except Exception as exc:
            logger.warning("Supabase agent_runs patch failed: %s", exc)


@contextmanager
def agent_run(
    agent_id: str,
    *,
    wallet_address: str | None = None,
    trigger_source: str = "manual",
    trigger_event: str | None = None,
) -> Generator[AgentRunLogger, None, None]:
    run = AgentRunLogger(
        agent_id,
        wallet_address=wallet_address,
        trigger_source=trigger_source,
        trigger_event=trigger_event,
    )
    run.start()
    try:
        yield run
    except Exception as exc:
        run.log(str(exc), level="error")
        run.finish(success=False, summary=str(exc), error=str(exc))
        raise
    else:
        run.finish(success=True, summary="completed")
