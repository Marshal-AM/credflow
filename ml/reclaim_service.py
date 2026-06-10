"""Reclaim Protocol bank balance sessions — INR parse, FX conversion, proof storage.

Sessions live in-process memory only (no disk persistence). Restarting the ML API
clears pending/verified Reclaim state; complete bank login again after a restart.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("credflow.reclaim")

ROOT = Path(__file__).resolve().parents[1]
RECLAIM_HELPER = ROOT / "scripts" / "reclaim_helper.js"
SESSION_TTL_SEC = int(os.environ.get("RECLAIM_SESSION_TTL_SEC", "900"))


@dataclass
class ReclaimSession:
    session_id: str
    wallet_address: str
    created_at: float
    status: str = "pending"  # pending | verified | expired
    request_url: str | None = None
    status_url: str | None = None
    verification_mode: str = "portal"
    config: str | None = None
    balance_inr_paise: int | None = None
    balance_usd_cents: int | None = None
    fx_rate_inr_per_usd: float | None = None
    fx_source: str | None = None
    fx_fetched_at: str | None = None
    proof_hash: str | None = None
    extracted_params: dict = field(default_factory=dict)


_sessions: dict[str, ReclaimSession] = {}
_fx_cache: dict[str, Any] = {"rate": None, "source": None, "fetched_at": 0.0}


def reclaim_enabled() -> bool:
    return os.environ.get("RECLAIM_ENABLED", "0").strip() in ("1", "true", "yes")


def use_mock_reclaim() -> bool:
    return os.environ.get("USE_MOCK_RECLAIM", "0").strip() in ("1", "true", "yes")


def _cleanup_expired() -> None:
    now = time.time()
    for sid, session in list(_sessions.items()):
        if now - session.created_at > SESSION_TTL_SEC:
            if session.status == "pending":
                _sessions.pop(sid, None)
            else:
                session.status = "expired"


def parse_balance_inr(extracted_params: dict) -> float:
    raw = (
        extracted_params.get("balance")
        or extracted_params.get("accountBalance")
        or extracted_params.get("availableBalance")
        or "0"
    )
    if isinstance(raw, (int, float)):
        return float(raw)
    cleaned = re.sub(r"[^0-9.]", "", str(raw))
    return float(cleaned) if cleaned else 0.0


def fetch_inr_per_usd() -> tuple[float, str]:
    """Return INR per 1 USD and source label."""
    now = time.time()
    if _fx_cache["rate"] and now - _fx_cache["fetched_at"] < 3600:
        return _fx_cache["rate"], _fx_cache["source"]

    fallback = float(os.environ.get("INR_PER_USD", "86"))
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get("https://api.exchangerate.host/latest", params={"base": "USD", "symbols": "INR"})
            resp.raise_for_status()
            data = resp.json()
            rate = float(data["rates"]["INR"])
            source = "exchangerate.host"
    except Exception as exc:
        logger.warning("FX API failed (%s), using INR_PER_USD=%s", exc, fallback)
        rate = fallback
        source = "env_fallback"

    _fx_cache.update({"rate": rate, "source": source, "fetched_at": now})
    return rate, source


def inr_to_usd_cents(balance_inr: float, rate_inr_per_usd: float) -> int:
    if rate_inr_per_usd <= 0:
        rate_inr_per_usd = float(os.environ.get("INR_PER_USD", "86"))
    balance_usd = balance_inr / rate_inr_per_usd
    return int(round(balance_usd * 100))


def proof_hash_from_proof(proof: Any) -> str:
    payload = json.dumps(proof, sort_keys=True, default=str)
    return "0x" + hashlib.sha256(payload.encode()).hexdigest()


def _parse_helper_stdout(stdout: str) -> dict:
    text = stdout.strip()
    if not text:
        raise RuntimeError("reclaim_helper returned empty stdout")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("{"):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                pass
    start = text.find("{")
    if start < 0:
        raise RuntimeError(f"reclaim_helper: no JSON in stdout: {text[:500]!r}")
    return json.loads(text[start:])


def _run_node_helper(args: list[str], stdin: str | None = None) -> dict:
    env = {**os.environ}
    proc = subprocess.run(
        ["node", str(RECLAIM_HELPER), *args],
        input=stdin,
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        env=env,
        timeout=120,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or "reclaim_helper failed"
        raise RuntimeError(detail)
    try:
        return _parse_helper_stdout(proc.stdout)
    except json.JSONDecodeError as exc:
        detail = proc.stderr.strip() or proc.stdout.strip()
        raise RuntimeError(f"reclaim_helper invalid JSON output: {detail[:500]}") from exc


def create_session(wallet_address: str, callback_url: str) -> ReclaimSession:
    """Create Reclaim session — callback URL must match reclaim/balance.js (no query params)."""
    _cleanup_expired()
    session_id = str(uuid.uuid4())
    callback_url = callback_url.rstrip("/")

    if use_mock_reclaim():
        session = ReclaimSession(
            session_id=session_id,
            wallet_address=wallet_address.lower(),
            created_at=time.time(),
            request_url=f"mock://reclaim/{session_id}",
            config="{}",
        )
        _sessions[session_id] = session
        return session

    result = _run_node_helper(["create", "--callback-url", callback_url])
    session = ReclaimSession(
        session_id=session_id,
        wallet_address=wallet_address.lower(),
        created_at=time.time(),
        request_url=result["requestUrl"],
        status_url=result.get("statusUrl"),
        verification_mode=result.get("verificationMode", "portal"),
        config=result.get("config"),
    )
    _sessions[session_id] = session
    return session


def get_session(session_id: str) -> ReclaimSession | None:
    _cleanup_expired()
    session = _sessions.get(session_id)
    if not session:
        return None
    if time.time() - session.created_at > SESSION_TTL_SEC and session.status != "verified":
        session.status = "expired"
    return session


def _reclaim_session_id_from_raw(raw_body: str) -> str | None:
    """Extract Reclaim portal sessionId embedded in proof context."""
    from urllib.parse import unquote

    text = raw_body.strip()
    parsers = [
        lambda t: json.loads(unquote(t)),
        lambda t: json.loads(t),
    ]
    for parse in parsers:
        try:
            proof = parse(text)
            items = proof if isinstance(proof, list) else [proof]
            for item in items:
                claim = (item or {}).get("claimData") or {}
                ctx_raw = claim.get("context") or "{}"
                ctx = json.loads(ctx_raw) if isinstance(ctx_raw, str) else ctx_raw
                nonce_data = ctx.get("attestationNonceData") or {}
                sid = ctx.get("reclaimSessionId") or nonce_data.get("sessionId")
                if sid:
                    return str(sid)
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return None


def _pending_session_for_reclaim_id(reclaim_sid: str) -> ReclaimSession | None:
    for session in _sessions.values():
        if session.status != "pending" or not session.config:
            continue
        try:
            cfg = json.loads(session.config)
        except json.JSONDecodeError:
            continue
        if cfg.get("sessionId") == reclaim_sid:
            return session
    return None


def bind_wallet_to_pending_session(wallet_address: str) -> ReclaimSession | None:
    """Return verified session for wallet if proof already received."""
    wallet = wallet_address.lower()
    for session in _sessions.values():
        if session.wallet_address == wallet and session.status == "verified":
            return session
    return None


def get_pending_session_for_wallet(wallet_address: str) -> ReclaimSession | None:
    """Return the newest pending Reclaim session with a portal URL for this wallet."""
    wallet = wallet_address.lower()
    pending = [
        s
        for s in _sessions.values()
        if s.wallet_address == wallet and s.status == "pending" and s.request_url
    ]
    if not pending:
        return None
    return max(pending, key=lambda s: s.created_at)


def clear_sessions_for_wallet(wallet_address: str) -> int:
    """Remove all in-memory Reclaim sessions for a wallet."""
    wallet = wallet_address.lower()
    removed = 0
    for sid, session in list(_sessions.items()):
        if session.wallet_address == wallet:
            _sessions.pop(sid, None)
            removed += 1
    return removed


def process_proof_callback(raw_body: str, wallet_hint: str | None = None) -> ReclaimSession:
    """Verify Reclaim proof and attach to matching pending session."""
    _cleanup_expired()

    if use_mock_reclaim():
        mock_inr = float(os.environ.get("MOCK_RECLAIM_BALANCE_INR", "100000"))
        rate, source = fetch_inr_per_usd()
        usd_cents = inr_to_usd_cents(mock_inr, rate)
        session_id = wallet_hint or next(
            (s.session_id for s in _sessions.values() if s.status == "pending"),
            str(uuid.uuid4()),
        )
        session = _sessions.get(session_id) or ReclaimSession(
            session_id=session_id,
            wallet_address=(wallet_hint or "0x0").lower(),
            created_at=time.time(),
        )
        session.status = "verified"
        session.balance_inr_paise = int(round(mock_inr * 100))
        session.balance_usd_cents = usd_cents
        session.fx_rate_inr_per_usd = rate
        session.fx_source = source
        session.fx_fetched_at = datetime.now(timezone.utc).isoformat()
        session.proof_hash = "0x" + "0" * 64
        session.extracted_params = {"balance": str(mock_inr)}
        _sessions[session_id] = session
        return session

    reclaim_sid = _reclaim_session_id_from_raw(raw_body)
    session = _pending_session_for_reclaim_id(reclaim_sid) if reclaim_sid else None

    if not session:
        pending = [
            s
            for s in _sessions.values()
            if s.status == "pending" and time.time() - s.created_at <= SESSION_TTL_SEC
        ]
        if wallet_hint:
            pending = [s for s in pending if s.wallet_address == wallet_hint.lower()] or pending
        if not pending:
            raise ValueError("No pending Reclaim session for this proof")
        session = pending[0]

    result = _run_node_helper(["verify"], stdin=raw_body)

    if not result.get("valid"):
        raise ValueError(result.get("error", "Invalid Reclaim proof"))

    extracted = result.get("extractedParameters") or {}
    balance_inr = parse_balance_inr(extracted)
    rate, source = fetch_inr_per_usd()
    usd_cents = inr_to_usd_cents(balance_inr, rate)
    phash = proof_hash_from_proof(extracted)

    session.status = "verified"
    session.balance_inr_paise = int(round(balance_inr * 100))
    session.balance_usd_cents = usd_cents
    session.fx_rate_inr_per_usd = rate
    session.fx_source = source
    session.fx_fetched_at = datetime.now(timezone.utc).isoformat()
    session.proof_hash = phash
    session.extracted_params = extracted
    return session


def session_to_payload(session: ReclaimSession) -> dict:
    return {
        "session_id": session.session_id,
        "wallet_address": session.wallet_address,
        "status": session.status,
        "request_url": session.request_url,
        "status_url": session.status_url,
        "verification_mode": session.verification_mode,
        "balance_inr_paise": session.balance_inr_paise,
        "balance_usd_cents": session.balance_usd_cents,
        "fx_rate_inr_per_usd": session.fx_rate_inr_per_usd,
        "fx_source": session.fx_source,
        "fx_fetched_at": session.fx_fetched_at,
        "reclaim_proof_hash": session.proof_hash,
        "extracted_params": session.extracted_params,
    }
