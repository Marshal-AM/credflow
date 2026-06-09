"""Underwriter agent — scoring API, hard rules, Groq borderline review."""

from __future__ import annotations

import argparse
import logging
import os
import sys

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


def _clamp_uint16(value: int) -> int:
    return max(0, min(65535, int(value)))


def _is_borderline(cred_score: int, sybil_risk: str) -> bool:
    """Groq reviews uncertain scores only. Low/medium sybil pass when score >= 500."""
    if sybil_risk == "high":
        return False
    return BORDERLINE_LOW <= cred_score <= BORDERLINE_HIGH


def underwrite_wallet(agent: CredFlowAgent, wallet: str, rescore: bool = False) -> dict:
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

    logger.info("Calling scoring API for %s", wallet)
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(f"{SCORING_API_URL}/score", json={"wallet_address": wallet})
        resp.raise_for_status()
        score_data = resp.json()

    cred_score = int(score_data["cred_score"])
    sybil_risk = score_data.get("sybil_risk", "low")
    approved = score_data.get("approved", False)
    borrow_sub = _clamp_uint16(score_data.get("borrow_sub_score", 0))
    wallet_sub = _clamp_uint16(score_data.get("wallet_sub_score", 0))
    shap_cid = str(score_data.get("shap_cid", ""))

    # Hard rules — Groq cannot override
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
            # Groq outage + strong score above borderline band: hard rules already passed
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
    elif not approved:
        return {
            "wallet": wallet,
            "action": "reject",
            "reason": score_data.get("rejection_reason", "Not approved"),
            "cred_score": cred_score,
        }

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
        "borrow_sub_score": borrow_sub,
        "wallet_sub_score": wallet_sub,
        "shap_cid": shap_cid,
        "sybil_risk": sybil_risk,
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
