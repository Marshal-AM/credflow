"""Persist minimal liquidation graph data on account_profiles."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from web3 import Web3

logger = logging.getLogger(__name__)


def _supabase_config() -> tuple[str, str]:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for liquidation snapshots"
        )
    return url.rstrip("/"), key


def _headers(key: str, *, merge: bool = False) -> dict[str, str]:
    prefer = "resolution=merge-duplicates,return=minimal" if merge else "return=minimal"
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def save_liquidation_snapshot(borrower: str, blacklisted: list[str]) -> None:
    """Store borrower + blacklisted linked wallets for post-default UI."""
    if not blacklisted:
        return
    try:
        url, key = _supabase_config()
        wallet = borrower.lower()
        payload = {
            "wallet_address": wallet,
            "liquidation_snapshot": {
                "borrower": borrower,
                "blacklisted": [Web3.to_checksum_address(a) for a in blacklisted],
                "saved_at": datetime.now(timezone.utc).isoformat(),
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                f"{url}/rest/v1/account_profiles",
                headers=_headers(key, merge=True),
                content=json.dumps(payload),
            )
            if resp.status_code >= 400:
                logger.warning("liquidation_snapshot save failed: %s", resp.text[:300])
    except Exception as exc:
        logger.warning("liquidation_snapshot save error: %s", exc)


def clear_liquidation_snapshot(wallet: str) -> None:
    """Remove stored graph when wallet is whitelisted or cache reset."""
    try:
        url, key = _supabase_config()
        normalized = wallet.lower()
        with httpx.Client(timeout=15.0) as client:
            resp = client.patch(
                f"{url}/rest/v1/account_profiles?wallet_address=eq.{normalized}",
                headers=_headers(key),
                content=json.dumps({"liquidation_snapshot": None}),
            )
            if resp.status_code >= 400:
                logger.warning("liquidation_snapshot clear failed: %s", resp.text[:300])
    except Exception as exc:
        logger.warning("liquidation_snapshot clear error: %s", exc)


def snapshot_from_liquidation_result(result: dict[str, Any]) -> None:
    """Extract blacklisted wallets from a liquidation agent result."""
    blacklisted = result.get("blacklisted") or []
    borrower = result.get("borrower")
    if not borrower or not isinstance(blacklisted, list) or not blacklisted:
        return
    save_liquidation_snapshot(str(borrower), [str(a) for a in blacklisted])
