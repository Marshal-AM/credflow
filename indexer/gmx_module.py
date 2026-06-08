"""GMX trading history — cross-chain reputation (Arbitrum mainnet only)."""

import logging
import os

import requests
from dotenv import load_dotenv

from indexer.chains import GMX_REPUTATION_CHAIN

load_dotenv()

logger = logging.getLogger(__name__)


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"
GMX_SUBGRAPH = os.environ.get(
    "GMX_SUBGRAPH",
    "https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql",
)

GMX_ACCOUNT_QUERY = """
query ($account: String!) {
  positions(where: {account_eq: $account, isSnapshot_eq: false}, limit: 200) {
    leverage
    sizeInUsd
    realizedPnl
    openedAt
  }
  tradeActions(where: {account_eq: $account}, limit: 500) {
    liquidationFeeAmount
    pnlUsd
    timestamp
  }
  positionChanges(where: {account_eq: $account}, limit: 500) {
    type
    timestamp
    basePnlUsd
  }
}
"""


def fetch_gmx_history(wallet_address: str) -> dict:
    """Fetch GMX position history and compute sub-score."""
    if _use_mock_data():
        from indexer.mock_data import mock_gmx_history

        return mock_gmx_history()

    account = wallet_address.lower()
    try:
        response = requests.post(
            GMX_SUBGRAPH,
            json={"query": GMX_ACCOUNT_QUERY, "variables": {"account": account}},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json().get("data", {})
        positions = data.get("positions", []) or []
        trade_actions = data.get("tradeActions", []) or []
        position_changes = data.get("positionChanges", []) or []
    except Exception as exc:
        logger.warning("GMX fetch failed for %s: %s", wallet_address, exc)
        positions = []
        trade_actions = []
        position_changes = []

    if not positions and not trade_actions and not position_changes:
        return {
            "has_gmx_history": False,
            "gmx_sub_score": 50,
            "chain": GMX_REPUTATION_CHAIN.key,
            "note": "GMX v2 only on Arbitrum mainnet — cross-chain reputation signal",
        }

    total = max(len(positions), len({c.get("timestamp") for c in position_changes}))
    liquidations = sum(
        1
        for action in trade_actions
        if float(action.get("liquidationFeeAmount", 0) or 0) > 0
    )

    leverage_values = [float(p.get("leverage", 0) or 0) for p in positions if p.get("leverage")]
    avg_leverage = sum(leverage_values) / len(leverage_values) if leverage_values else 0.0

    timestamps = sorted(
        int(item.get("timestamp") or item.get("openedAt") or 0)
        for item in (*position_changes, *trade_actions, *positions)
        if item.get("timestamp") or item.get("openedAt")
    )
    if len(timestamps) >= 2:
        avg_duration = (timestamps[-1] - timestamps[0]) / max(1, total) / 86400
    else:
        avg_duration = 0.0

    total_pnl = sum(float(p.get("realizedPnl", 0) or 0) for p in positions)
    total_pnl += sum(float(a.get("pnlUsd", 0) or 0) for a in trade_actions)

    liq_penalty = liquidations * 15
    leverage_penalty = max(0, (avg_leverage - 5) * 2)
    duration_bonus = min(20, avg_duration * 0.5)
    pnl_bonus = min(10, max(-10, total_pnl / 1000))
    experience_bonus = min(15, total * 0.5)

    raw_score = 70 - liq_penalty - leverage_penalty + duration_bonus + pnl_bonus + experience_bonus
    final_score = max(0, min(100, round(raw_score)))

    return {
        "has_gmx_history": True,
        "chain": GMX_REPUTATION_CHAIN.key,
        "total_positions": total,
        "liquidation_count": liquidations,
        "avg_leverage": avg_leverage,
        "avg_duration_days": avg_duration,
        "total_pnl_usd": total_pnl,
        "gmx_sub_score": final_score,
    }
