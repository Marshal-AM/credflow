"""Test-default helpers — oracle crash, health warning, grace, unblacklist."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from web3 import Web3

from agents.base import CredFlowAgent
from agents.state import expire_grace_for_test, grace_state, start_grace

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
ABIS_DIR = ROOT / "docs" / "abis"


def _load_abi(name: str) -> list[dict]:
    with open(ABIS_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def _read_eth_feed_price_usd(agent: CredFlowAgent) -> tuple[str, float]:
    weth = Web3.to_checksum_address(agent.addresses["weth"])
    oracle = agent.w3.eth.contract(
        address=Web3.to_checksum_address(agent.addresses["oracle"]),
        abi=_load_abi("ChainlinkOracle.json"),
    )
    feed_addr = oracle.functions.priceFeeds(weth).call()
    if feed_addr == "0x0000000000000000000000000000000000000000":
        raise RuntimeError("WETH feed not wired — run npm run oracle:wire")
    feed = agent.w3.eth.contract(
        address=Web3.to_checksum_address(feed_addr),
        abi=[
            {"name": "price", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "int256"}]},
        ],
    )
    raw = int(feed.functions.price().call())
    return feed_addr, raw / 10**8


def ensure_liquidatable(loan_id: int, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    """Lower mock ETH/USD until on-chain LTV >= liquidationThreshold (test default)."""
    agent = agent or CredFlowAgent()
    lending = agent.lending
    ltv = int(lending.functions.getCurrentLTV(loan_id).call())
    threshold = int(lending.functions.liquidationThreshold().call())
    if ltv >= threshold:
        return {
            "loan_id": loan_id,
            "crashed": False,
            "ltv_bps": ltv,
            "liquidation_threshold_bps": threshold,
        }

    _, current_price = _read_eth_feed_price_usd(agent)
    # LTV ∝ 1/price — scale price down so LTV reaches threshold (+5% buffer).
    buffer = 1.05
    target_price = current_price * ltv / (threshold * buffer)
    target_price = max(target_price, 1.0)

    crash = crash_eth_oracle(target_price, agent=agent)
    new_ltv = int(lending.functions.getCurrentLTV(loan_id).call())
    if new_ltv < threshold:
        raise RuntimeError(
            f"Oracle crash to ${target_price:.2f} left LTV {new_ltv} bps < threshold {threshold} — try lower manually"
        )
    return {
        "loan_id": loan_id,
        "crashed": True,
        "ltv_before_bps": ltv,
        "ltv_after_bps": new_ltv,
        "liquidation_threshold_bps": threshold,
        "target_eth_price_usd": target_price,
        "previous_eth_price_usd": current_price,
        **crash,
    }


def crash_eth_oracle(eth_price_usd: float, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    """Set hub mock Chainlink WETH/USD feed price (testnet)."""
    agent = agent or CredFlowAgent()
    if eth_price_usd <= 0:
        raise ValueError("eth_price_usd must be positive")

    feed_addr, _ = _read_eth_feed_price_usd(agent)

    feed = agent.w3.eth.contract(
        address=Web3.to_checksum_address(feed_addr),
        abi=[
            {"name": "owner", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
            {"name": "setPrice", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "newPrice", "type": "int256"}], "outputs": []},
        ],
    )
    owner = feed.functions.owner().call()
    if owner.lower() != agent.account.address.lower():
        raise RuntimeError(
            f"Agent {agent.account.address} is not feed owner ({owner}) — cannot setPrice"
        )

    new_price = int(eth_price_usd * 10**8)
    tx = agent.send_tx(feed.functions.setPrice(new_price))
    return {
        "eth_price_usd": eth_price_usd,
        "feed": feed_addr,
        "set_price_tx": tx,
    }


def emit_health_warning(loan_id: int, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    loan = agent.lending.functions.loans(loan_id).call()
    if not loan[8]:
        raise ValueError(f"Loan {loan_id} is not active")
    ltv = agent.lending.functions.getCurrentLTV(loan_id).call()
    threshold = agent.lending.functions.liquidationThreshold().call()
    tx = agent.send_tx(agent.lending.functions.emitHealthWarning(loan_id))
    return {
        "loan_id": loan_id,
        "ltv_bps": int(ltv),
        "liquidation_threshold_bps": int(threshold),
        "health_warning_tx": tx,
    }


def start_covenant_grace(loan_id: int) -> dict[str, Any]:
    """Soft recovery — covenant breach / 48h grace (user story alternate ending)."""
    start_grace(loan_id)
    return {"loan_id": loan_id, "grace": grace_state().get(str(loan_id)), "status": "grace_started"}


def force_expire_grace(loan_id: int) -> dict[str, Any]:
    """Test-only: end grace immediately so liquidation can proceed."""
    expire_grace_for_test(loan_id)
    return {"loan_id": loan_id, "grace": grace_state().get(str(loan_id)), "status": "grace_expired"}


def unblacklist_wallet(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)
    was = agent.sbt.functions.isBlacklisted(wallet).call()
    if not was:
        return {"wallet": wallet, "was_blacklisted": False, "status": "not_blacklisted"}
    tx = agent.send_tx(agent.sbt.functions.removeFromBlacklist(wallet))
    return {
        "wallet": wallet,
        "was_blacklisted": True,
        "unblacklist_tx": tx,
        "is_blacklisted": agent.sbt.functions.isBlacklisted(wallet).call(),
    }
