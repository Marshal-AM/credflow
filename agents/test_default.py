"""Test-default helpers — oracle crash, health warning, grace, whitelist."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from web3 import Web3

from agents.base import CredFlowAgent, SpokeAgent

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
    from agents.state import grace_state, start_grace

    start_grace(loan_id)
    return {"loan_id": loan_id, "grace": grace_state().get(str(loan_id)), "status": "grace_started"}


def force_expire_grace(loan_id: int) -> dict[str, Any]:
    """Test-only: end grace immediately so liquidation can proceed."""
    from agents.state import expire_grace_for_test, grace_state

    expire_grace_for_test(loan_id)
    return {"loan_id": loan_id, "grace": grace_state().get(str(loan_id)), "status": "grace_expired"}


def _hub_whitelist_tx(
    agent: CredFlowAgent,
    wallet: str,
    *,
    was_blacklisted: bool,
    default_count_before: int,
) -> tuple[str | None, bool]:
    """Returns (tx_hash, full_reset). full_reset False if only explicit blacklist cleared."""
    if not was_blacklisted and default_count_before <= 0:
        return None, True
    try:
        tx = agent.send_tx(agent.sbt.functions.whitelistWallet(wallet))
        return tx, True
    except Exception as exc:
        logger.warning("whitelistWallet failed (%s)", exc)
        if was_blacklisted:
            tx = agent.send_tx(agent.sbt.functions.removeFromBlacklist(wallet))
            if default_count_before > 0:
                raise RuntimeError(
                    "Cleared hub blacklist but defaultCount remains — upgrade CredScoreSBT "
                    "with whitelistWallet and retry"
                ) from exc
            return tx, True
        raise RuntimeError(
            "Hub defaultCount > 0 but whitelistWallet unavailable — upgrade CredScoreSBT"
        ) from exc


def _clear_spoke_blacklist(wallet: str, score: int) -> list[dict[str, Any]]:
    """Direct spoke OApp clear (fallback when LZ whitelist is in flight)."""
    spoke_txs: list[dict[str, Any]] = []
    for chain in ("arbitrum", "base"):
        try:
            spoke = SpokeAgent(chain)
            if not spoke.oapp.functions.isBlacklisted(wallet).call():
                continue
            try:
                tx = spoke.send_tx(spoke.oapp.functions.clearDefaultBlacklist(wallet, int(score)))
            except Exception as exc:
                logger.warning(
                    "clearDefaultBlacklist unavailable on %s (%s) — upgrade spoke OApp",
                    chain,
                    exc,
                )
                continue
            spoke_txs.append({"chain_key": chain, "tx_hash": tx, "type": "spoke_clear"})
            logger.info("clearDefaultBlacklist %s tx=%s", chain, tx)
        except Exception as exc:
            logger.warning("Spoke whitelist clear failed on %s: %s", chain, exc)
    return spoke_txs


def whitelist_wallet(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    """Full test recovery: hub SBT blacklist + defaultCount, then spoke LZ/direct clear."""
    agent = agent or CredFlowAgent()
    wallet = Web3.to_checksum_address(wallet)

    was_blacklisted = bool(agent.sbt.functions.isBlacklisted(wallet).call())
    spoke_blacklisted = False
    for chain in ("arbitrum", "base"):
        try:
            spoke = SpokeAgent(chain)
            if spoke.oapp.functions.isBlacklisted(wallet).call():
                spoke_blacklisted = True
                break
        except Exception:
            continue

    if not agent.sbt.functions.hasProfile(wallet).call():
        if was_blacklisted:
            tx = agent.send_tx(agent.sbt.functions.removeFromBlacklist(wallet))
            spoke_txs = _clear_spoke_blacklist(wallet, 0)
            lz_txs = agent.broadcast_whitelist(wallet, 0) if spoke_blacklisted else []
            return {
                "wallet": wallet,
                "status": "whitelisted",
                "whitelist_tx": tx,
                "unblacklist_tx": tx,
                "was_blacklisted": True,
                "default_count_before": 0,
                "default_count_after": 0,
                "is_blacklisted": False,
                "lz_whitelist_tx": lz_txs,
                "spoke_clear_tx": spoke_txs,
            }
        if spoke_blacklisted:
            spoke_txs = _clear_spoke_blacklist(wallet, 0)
            lz_txs = agent.broadcast_whitelist(wallet, 0)
            return {
                "wallet": wallet,
                "status": "whitelisted",
                "whitelist_tx": None,
                "unblacklist_tx": None,
                "was_blacklisted": False,
                "default_count_before": 0,
                "default_count_after": 0,
                "is_blacklisted": False,
                "lz_whitelist_tx": lz_txs,
                "spoke_clear_tx": spoke_txs,
            }
        return {"wallet": wallet, "status": "no_profile"}

    profile = agent.sbt.functions.getProfile(wallet).call()
    default_count_before = int(profile[5])
    score = int(profile[0])

    hub_needs_clear = was_blacklisted or default_count_before > 0

    if not hub_needs_clear and not spoke_blacklisted:
        return {
            "wallet": wallet,
            "status": "already_whitelisted",
            "was_blacklisted": was_blacklisted,
            "default_count_before": default_count_before,
            "is_blacklisted": False,
            "default_count_after": default_count_before,
        }

    whitelist_tx: str | None = None
    if hub_needs_clear:
        whitelist_tx, _full = _hub_whitelist_tx(
            agent,
            wallet,
            was_blacklisted=was_blacklisted,
            default_count_before=default_count_before,
        )

    lz_txs: list[dict] = []
    if spoke_blacklisted or hub_needs_clear:
        try:
            lz_txs = agent.broadcast_whitelist(wallet, score)
        except Exception as exc:
            logger.warning("broadcastWhitelist failed (%s) — using direct spoke clear only", exc)
    spoke_txs = _clear_spoke_blacklist(wallet, score)

    profile_after = agent.sbt.functions.getProfile(wallet).call()
    return {
        "wallet": wallet,
        "status": "whitelisted",
        "whitelist_tx": whitelist_tx,
        "unblacklist_tx": whitelist_tx,
        "was_blacklisted": was_blacklisted,
        "default_count_before": default_count_before,
        "default_count_after": int(profile_after[5]),
        "is_blacklisted": bool(agent.sbt.functions.isBlacklisted(wallet).call()),
        "lz_whitelist_tx": lz_txs,
        "spoke_clear_tx": spoke_txs,
    }


def unblacklist_wallet(wallet: str, agent: CredFlowAgent | None = None) -> dict[str, Any]:
    """Backward-compatible alias — performs full whitelist sync."""
    return whitelist_wallet(wallet, agent=agent)
