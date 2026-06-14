"""Targeted LayerZero sync for a single wallet (score + loan state)."""

from __future__ import annotations

import logging
from typing import Any

from web3 import Web3

from agents.base import CredFlowAgent, SpokeAgent

logger = logging.getLogger(__name__)

EID_TO_CHAIN = {
    40231: "arbitrum",
    40245: "base",
}

SPOKE_CHAINS = ("arbitrum", "base")


def _chain_key_for_eid(eid: int) -> str:
    return EID_TO_CHAIN.get(eid, f"eid_{eid}")


def _profile_field(profile: Any, name: str, index: int) -> Any:
    if hasattr(profile, name):
        return getattr(profile, name)
    return profile[index]


def _spoke_active_loan_id(chain: str, wallet: str) -> int:
    try:
        spoke = SpokeAgent(chain)
        return int(spoke.lending.functions.activeLoanId(wallet).call())
    except Exception as exc:
        logger.warning("Could not read %s activeLoanId for %s: %s", chain, wallet, exc)
        return 0


def wallet_active_loan_sources(wallet: str, agent: CredFlowAgent | None = None) -> list[str]:
    """Return chain keys where the wallet currently has an active CredFlow loan."""
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    sources: list[str] = []

    hub_id = int(agent.lending.functions.activeLoanId(wallet).call())
    if hub_id > 0:
        sources.append("hub")

    for chain in SPOKE_CHAINS:
        if _spoke_active_loan_id(chain, wallet) > 0:
            sources.append(chain)

    return sources


def _ensure_hub_sbt_loan_active(wallet: str, agent: CredFlowAgent) -> str | None:
    """Mirror spoke borrow on hub SBT so hub lending rejects double-borrow."""
    profile = agent.sbt.functions.getProfile(wallet).call()
    if not _profile_field(profile, "exists", 7):
        return None
    if _profile_field(profile, "loanActive", 8):
        return None
    try:
        return agent.send_tx(agent.sbt.functions.setLoanActive(wallet))
    except Exception as exc:
        logger.warning("Could not set hub SBT loanActive for %s: %s", wallet, exc)
        return None


def _clear_hub_sbt_loan_active(wallet: str, agent: CredFlowAgent) -> str | None:
    profile = agent.sbt.functions.getProfile(wallet).call()
    if not _profile_field(profile, "exists", 7):
        return None
    if not _profile_field(profile, "loanActive", 8):
        return None
    try:
        return agent.send_tx(agent.sbt.functions.setLoanRepaid(wallet))
    except Exception as exc:
        logger.warning("Could not clear hub SBT loanActive for %s: %s", wallet, exc)
        return None


def sync_wallet_score(wallet: str, score: int, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    txs = agent.broadcast_score(wallet, score)
    return {
        "wallet": wallet,
        "score": score,
        "message_type": "score",
        "hub_tx_hashes": txs,
    }


def sync_wallet_loan_active(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    sources = wallet_active_loan_sources(wallet, agent)
    if not sources:
        logger.info(
            "No active loan on hub or spokes for %s — broadcasting repaid clear instead of loan_active",
            wallet,
        )
        return sync_wallet_repaid_clear(wallet, agent=agent)

    profile = agent.sbt.functions.getProfile(wallet).call()
    score = int(_profile_field(profile, "score", 0))
    sbt_tx: str | None = None
    if "hub" not in sources:
        sbt_tx = _ensure_hub_sbt_loan_active(wallet, agent)

    score_txs = agent.broadcast_score(wallet, score)
    loan_txs = agent.broadcast_loan_active(wallet)
    all_txs = score_txs + loan_txs
    result: dict[str, Any] = {
        "wallet": wallet,
        "score": score,
        "message_type": "loan_active",
        "hub_tx_hashes": all_txs,
        "active_on": sources,
    }
    if sbt_tx:
        result["hub_sbt_tx"] = sbt_tx
    return result


def sync_wallet_repaid(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    profile = agent.sbt.functions.getProfile(wallet).call()
    score = int(_profile_field(profile, "score", 0))
    return sync_wallet_repaid_with_score(wallet, score, agent=agent)


def sync_wallet_repaid_clear(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    """Broadcast repaid only — clears stale loanActiveMirror on spokes (no hub repay tx)."""
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    repaid_txs = agent.broadcast_repaid(wallet)
    return {
        "wallet": wallet,
        "message_type": "repaid_clear",
        "hub_tx_hashes": repaid_txs,
    }


def sync_wallet_repaid_with_score(
    wallet: str,
    score: int,
    agent: CredFlowAgent | None = None,
) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    sources = wallet_active_loan_sources(wallet, agent)
    if sources:
        logger.info(
            "Active loan still on %s for %s — skipping repaid LayerZero broadcast",
            ",".join(sources),
            wallet,
        )
        return {
            "wallet": wallet,
            "score": score,
            "message_type": "repaid_skipped",
            "hub_tx_hashes": [],
            "active_on": sources,
        }

    sbt_tx = _clear_hub_sbt_loan_active(wallet, agent)
    score_txs = agent.broadcast_score(wallet, score)
    repaid_txs = agent.broadcast_repaid(wallet)
    all_txs = score_txs + repaid_txs
    result: dict[str, Any] = {
        "wallet": wallet,
        "score": score,
        "message_type": "repaid",
        "hub_tx_hashes": all_txs,
    }
    if sbt_tx:
        result["hub_sbt_tx"] = sbt_tx
    return result
