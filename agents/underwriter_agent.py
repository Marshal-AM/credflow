"""Underwriter agent — scoring API, hard rules, Groq borderline review, on-chain CredScoreEngine."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv
from web3 import Web3

from agents.base import CredFlowAgent
from agents.groq_brain import review_underwriting

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | underwriter | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

SCORING_API_URL = os.environ.get("SCORING_API_URL", "http://localhost:8000")
BORDERLINE_LOW = int(os.environ.get("UNDERWRITER_BORDERLINE_LOW", "480"))
BORDERLINE_HIGH = int(os.environ.get("UNDERWRITER_BORDERLINE_HIGH", "520"))
RECLAIM_POLL_SEC = int(os.environ.get("RECLAIM_POLL_SEC", "5"))
RECLAIM_POLL_MAX = int(os.environ.get("RECLAIM_POLL_MAX", "180"))
SCORE_HTTP_TIMEOUT_SEC = float(os.environ.get("SCORING_HTTP_TIMEOUT_SEC", "1000"))


def _score_http_timeout() -> httpx.Timeout:
    """Scoring runs can take several minutes (indexer + sybil graph)."""
    return httpx.Timeout(SCORE_HTTP_TIMEOUT_SEC, connect=30.0)


def _clamp_uint16(value: int) -> int:
    return max(0, min(65535, int(value)))


def _resolve_onchain_cred_score(score_data: dict) -> int:
    """Authoritative hub SBT score — ML output unless reclaim formula applies."""
    if score_data.get("reclaim_proof_hash") or score_data.get("reclaim"):
        return int(score_data.get("on_chain_cred_score") or score_data["cred_score"])
    ml = score_data.get("ml_cred_score")
    if ml is not None:
        return int(ml)
    return int(score_data.get("on_chain_cred_score") or score_data["cred_score"])


def _reclaim_enabled() -> bool:
    return os.environ.get("RECLAIM_ENABLED", "0").strip() in ("1", "true", "yes")


def _is_borderline(cred_score: int, sybil_risk: str) -> bool:
    """Groq reviews uncertain scores only. Low/medium sybil pass when score >= 500."""
    if sybil_risk == "high":
        return False
    return BORDERLINE_LOW <= cred_score <= BORDERLINE_HIGH


def _fetch_score_data(
    client: httpx.Client,
    wallet: str,
    *,
    reclaim_session_id: str | None = None,
    require_reclaim: bool | None = None,
) -> dict:
    payload = {
        "wallet_address": wallet,
        "require_reclaim": require_reclaim if require_reclaim is not None else _reclaim_enabled(),
    }
    if reclaim_session_id:
        payload["reclaim_session_id"] = reclaim_session_id
        payload["require_reclaim"] = True
    resp = client.post(
        f"{SCORING_API_URL}/score",
        json=payload,
        timeout=_score_http_timeout(),
    )
    resp.raise_for_status()
    return resp.json()


def _wait_for_reclaim_score(client: httpx.Client, wallet: str, initial: dict) -> dict:
    """Poll scoring API until Reclaim proof is verified and full score is ready."""
    session_id = initial.get("reclaim_session_id")
    reclaim_url = initial.get("reclaim_url")
    logger.info("Awaiting Reclaim proof — open: %s", reclaim_url)

    deadline = time.time() + RECLAIM_POLL_MAX
    while time.time() < deadline:
        data = _fetch_score_data(client, wallet, reclaim_session_id=session_id)
        if data.get("status") != "awaiting_reclaim":
            return data
        time.sleep(RECLAIM_POLL_SEC)

    raise TimeoutError(
        f"Reclaim proof not received within {RECLAIM_POLL_MAX}s. "
        f"Complete verification at: {reclaim_url}"
    )


def _proof_hash_bytes(proof_hash: str | None) -> bytes:
    if not proof_hash:
        return b"\x00" * 32
    h = proof_hash.removeprefix("0x")
    return bytes.fromhex(h.zfill(64))


def underwrite_wallet(
    agent: CredFlowAgent,
    wallet: str,
    rescore: bool = False,
    *,
    score_data: dict | None = None,
    reclaim_session_id: str | None = None,
) -> dict:
    wallet = Web3.to_checksum_address(wallet)

    if agent.sbt.functions.isBlacklisted(wallet).call():
        return {"wallet": wallet, "action": "reject", "reason": "Wallet blacklisted on-chain"}

    has_profile = agent.sbt.functions.hasProfile(wallet).call()
    if has_profile and not rescore:
        profile = agent.sbt.functions.getProfile(wallet).call()
        return {
            "wallet": wallet,
            "action": "skip",
            "reason": "Profile exists — use --rescore to update",
            "score": profile[0],
        }

    if score_data is None:
        require_reclaim = False if rescore else None
        logger.info(
            "Calling scoring API for %s (rescore=%s reclaim=%s timeout=%ss)",
            wallet,
            rescore,
            require_reclaim if require_reclaim is not None else _reclaim_enabled(),
            SCORE_HTTP_TIMEOUT_SEC,
        )
        with httpx.Client(timeout=_score_http_timeout()) as client:
            score_data = _fetch_score_data(
                client,
                wallet,
                reclaim_session_id=reclaim_session_id,
                require_reclaim=require_reclaim,
            )
            if score_data.get("status") == "awaiting_reclaim":
                score_data = _wait_for_reclaim_score(client, wallet, score_data)
    elif score_data.get("status") != "complete":
        return {
            "wallet": wallet,
            "action": "reject",
            "reason": "Score snapshot incomplete",
            "score_status": score_data.get("status"),
        }
    else:
        logger.info(
            "Using provided score snapshot for %s (rescore=%s cred_score=%s)",
            wallet,
            rescore,
            score_data.get("cred_score"),
        )

    cred_score = _resolve_onchain_cred_score(score_data)
    sybil_risk = score_data.get("sybil_risk", "low")
    borrow_sub = _clamp_uint16(score_data.get("borrow_sub_score", 0))
    wallet_sub = _clamp_uint16(score_data.get("wallet_sub_score", 0))
    shap_cid = str(score_data.get("shap_cid", ""))
    default_prob_bps = int(score_data.get("default_prob_bps", 0))
    balance_usd_cents = int(score_data.get("balance_usd_cents", 0))
    reclaim_proof_hash = score_data.get("reclaim_proof_hash")

    if sybil_risk == "high":
        return {
            "wallet": wallet,
            "action": "reject",
            "reason": "Hard rule: sybil_risk high",
            "cred_score": cred_score,
            "sybil_risk": sybil_risk,
        }
    if cred_score < 500:
        return {
            "wallet": wallet,
            "action": "reject",
            "reason": f"Hard rule: cred_score {cred_score} < 500",
            "cred_score": cred_score,
            "sybil_risk": sybil_risk,
        }

    action = "approve"
    groq_narrative = None

    if _is_borderline(cred_score, sybil_risk):
        verdict = review_underwriting(
            wallet,
            cred_score,
            sybil_risk,
            score_data.get("model_breakdown", {}),
        )
        groq_narrative = verdict.model_dump()
        if verdict.action != "approve":
            groq_unavailable = verdict.confidence == 0.0 and "unavailable" in verdict.reasoning.lower()
            if groq_unavailable and cred_score > BORDERLINE_HIGH and sybil_risk != "high":
                groq_narrative["override"] = "auto-approve: score above borderline, Groq unavailable"
                logger.warning("Groq unavailable — auto-approving strong score %s", cred_score)
            else:
                return {
                    "wallet": wallet,
                    "action": "reject",
                    "reason": f"Groq {verdict.action}: {verdict.reasoning}",
                    "cred_score": cred_score,
                    "sybil_risk": sybil_risk,
                    "groq": groq_narrative,
                }

    if has_profile and rescore:
        profile = agent.sbt.functions.getProfile(wallet).call()
        on_chain_score = int(profile[0])
        if on_chain_score == cred_score:
            logger.info("On-chain score already %s — skip updateScore", cred_score)
            return {
                "wallet": wallet,
                "action": "skip",
                "reason": "Score unchanged on-chain",
                "cred_score": cred_score,
                "onchain": None,
                "ml_cred_score": score_data.get("ml_cred_score"),
                "sybil_risk": sybil_risk,
            }

    use_engine = agent.score_engine is not None and _reclaim_enabled() and reclaim_proof_hash

    if use_engine:
        from ml.score_engine import compute_on_chain_cred_score

        engine_score = compute_on_chain_cred_score(default_prob_bps, balance_usd_cents)
        if cred_score > engine_score:
            logger.info(
                "Cred score %s above engine formula %s — using SBT updateScore",
                cred_score,
                engine_score,
            )
            use_engine = False

    if use_engine:
        proof_bytes = _proof_hash_bytes(reclaim_proof_hash)
        fn = agent.score_engine.functions.mintScore(
            wallet,
            default_prob_bps,
            balance_usd_cents,
            proof_bytes,
            borrow_sub,
            wallet_sub,
            shap_cid,
            rescore or has_profile,
        )
        tx = agent.send_tx(fn)
        onchain_action = "mintScore"
    else:
        score_uint16 = _clamp_uint16(cred_score)
        if has_profile or rescore:
            fn = agent.sbt.functions.updateScore(wallet, score_uint16, borrow_sub, wallet_sub, shap_cid)
            tx = agent.send_tx(fn)
            onchain_action = "updateScore"
        else:
            fn = agent.sbt.functions.mintSBT(wallet, score_uint16, borrow_sub, wallet_sub, shap_cid)
            tx = agent.send_tx(fn)
            onchain_action = "mintSBT"

    return {
        "wallet": wallet,
        "action": action,
        "onchain": onchain_action,
        "tx": tx,
        "cred_score": cred_score,
        "ml_cred_score": score_data.get("ml_cred_score"),
        "default_prob_bps": default_prob_bps,
        "balance_usd_cents": balance_usd_cents,
        "borrow_sub_score": borrow_sub,
        "wallet_sub_score": wallet_sub,
        "shap_cid": shap_cid,
        "sybil_risk": sybil_risk,
        "reclaim_proof_hash": reclaim_proof_hash,
        "groq": groq_narrative,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="CredFlow underwriter agent")
    parser.add_argument("wallet", help="Wallet address to underwrite")
    parser.add_argument("--rescore", action="store_true", help="Update existing SBT score")
    args = parser.parse_args()

    agent = CredFlowAgent()
    result = underwrite_wallet(agent, args.wallet, rescore=args.rescore)
    logger.info("Decision: %s", result)
    if result.get("action") == "reject":
        sys.exit(1)


if __name__ == "__main__":
    main()
