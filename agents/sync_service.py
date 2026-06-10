"""Targeted LayerZero sync for a single wallet (score + loan state)."""

from __future__ import annotations

import logging
from typing import Any

from web3 import Web3

from agents.base import CredFlowAgent

logger = logging.getLogger(__name__)

EID_TO_CHAIN = {
    40231: "arbitrum",
    40245: "base",
}


def _chain_key_for_eid(eid: int) -> str:
    return EID_TO_CHAIN.get(eid, f"eid_{eid}")


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
    loan_id = int(agent.lending.functions.activeLoanId(wallet).call())
    if loan_id == 0:
        logger.info("No hub loan for %s — broadcasting repaid clear instead of loan_active", wallet)
        return sync_wallet_repaid_clear(wallet, agent=agent)

    profile = agent.sbt.functions.getProfile(wallet).call()
    score = int(profile[0])
    score_txs = agent.broadcast_score(wallet, score)
    loan_txs = agent.broadcast_loan_active(wallet)
    all_txs = score_txs + loan_txs
    return {
        "wallet": wallet,
        "score": score,
        "message_type": "loan_active",
        "hub_tx_hashes": all_txs,
    }


def sync_wallet_repaid(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    profile = agent.sbt.functions.getProfile(wallet).call()
    score = int(profile[0])
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
    score_txs = agent.broadcast_score(wallet, score)
    repaid_txs = agent.broadcast_repaid(wallet)
    all_txs = score_txs + repaid_txs
    return {
        "wallet": wallet,
        "score": score,
        "message_type": "repaid",
        "hub_tx_hashes": all_txs,
    }
