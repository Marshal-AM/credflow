"""Read agent runs and log lines from Supabase."""

from __future__ import annotations

import os
from typing import Any

import httpx

TRACKED_AGENT_IDS = (
    "underwriter",
    "portfolio_monitor",
    "liquidation",
    "crosschain_sync",
    "rate_optimizer",
)


def _supabase_config() -> tuple[str, str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Supabase is not configured")
    return url.rstrip("/"), key


def _headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _get(path: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
    url, key = _supabase_config()
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(
            f"{url}/rest/v1/{path}",
            headers=_headers(key),
            params=params or {},
        )
        if resp.status_code >= 400:
            raise RuntimeError(resp.text[:300])
        data = resp.json()
        return data if isinstance(data, list) else []


def list_runs_from_supabase(
    *,
    wallet: str | None = None,
    agent_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    wallet_l = wallet.lower() if wallet else None
    agent_ids = [agent_id] if agent_id else list(TRACKED_AGENT_IDS)
    agent_filter = ",".join(agent_ids)

    params: dict[str, str] = {
        "select": "id,agent_id,wallet_address,trigger_source,trigger_event,status,started_at,finished_at,summary",
        "agent_id": f"in.({agent_filter})",
        "order": "started_at.desc",
        "limit": str(min(limit, 100)),
    }
    if wallet_l:
        params["or"] = f"(wallet_address.is.null,wallet_address.eq.{wallet_l})"

    rows = _get("agent_runs", params)
    return [
        {
            "id": row["id"],
            "agent_id": row["agent_id"],
            "status": row.get("status", "unknown"),
            "trigger_source": row.get("trigger_source"),
            "trigger_event": row.get("trigger_event"),
            "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"),
            "summary": row.get("summary"),
            "wallet_address": row.get("wallet_address"),
        }
        for row in rows
    ]


def logs_for_run(run_id: str) -> list[dict[str, Any]]:
    rows = _get(
        "agent_log_lines",
        {
            "select": "id,run_id,logged_at,level,message,metadata",
            "run_id": f"eq.{run_id}",
            "order": "logged_at.asc",
            "limit": "500",
        },
    )
    return [
        {
            "id": row["id"],
            "run_id": row["run_id"],
            "logged_at": row.get("logged_at"),
            "level": row.get("level", "info"),
            "message": row.get("message", ""),
            "metadata": row.get("metadata"),
        }
        for row in rows
    ]
