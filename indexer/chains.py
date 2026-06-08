"""CredFlow supported chains — Robinhood hub + LayerZero spokes."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ChainConfig:
    key: str
    chain_id: int
    role: str  # hub | spoke
    rpc_env: str
    alchemy_rpc_env: str | None = None


def _rpc(env_key: str, default: str = "") -> str:
    return os.environ.get(env_key, default).strip()


# Hub + LayerZero spokes (layerzero/config.json)
CREDFLOW_CHAINS: List[ChainConfig] = [
    ChainConfig(
        key="robinhood_testnet",
        chain_id=46630,
        role="hub",
        rpc_env="RPC_ROBINHOOD",
        alchemy_rpc_env="ALCHEMY_ROBINHOOD_RPC",
    ),
    ChainConfig(
        key="arbitrum_sepolia",
        chain_id=421614,
        role="spoke",
        rpc_env="RPC_ARBITRUM_SEPOLIA",
        alchemy_rpc_env="ALCHEMY_ARBITRUM_SEPOLIA_RPC",
    ),
    ChainConfig(
        key="base_sepolia",
        chain_id=84532,
        role="spoke",
        rpc_env="RPC_BASE_SEPOLIA",
        alchemy_rpc_env="ALCHEMY_BASE_SEPOLIA_RPC",
    ),
]


def hub_chain() -> ChainConfig:
    return CREDFLOW_CHAINS[0]


def spoke_chains() -> List[ChainConfig]:
    return [c for c in CREDFLOW_CHAINS if c.role == "spoke"]


# Morpho Blue is deployed on Base Sepolia only (not Arbitrum Sepolia).
MORPHO_SPOKE_KEYS = frozenset({"base_sepolia"})


def morpho_spoke_chains() -> List[ChainConfig]:
    return [c for c in spoke_chains() if c.key in MORPHO_SPOKE_KEYS]


def active_rpc_chains() -> List[ChainConfig]:
    """All chains queried via RPC/Alchemy for wallet state."""
    return list(CREDFLOW_CHAINS)


_ALCHEMY_CHAIN_URLS = {
    "robinhood_testnet": "https://robinhood-testnet.g.alchemy.com/v2/{key}",
    "arbitrum_sepolia": "https://arb-sepolia.g.alchemy.com/v2/{key}",
    "base_sepolia": "https://base-sepolia.g.alchemy.com/v2/{key}",
}


def chain_alchemy_rpc_url(chain: ChainConfig) -> str:
    """Alchemy RPC for indexed calls (getAssetTransfers). Used even when direct RPC is preferred."""
    key = os.environ.get("ALCHEMY_API_KEY", "").strip()
    if chain.alchemy_rpc_env:
        custom = _rpc(chain.alchemy_rpc_env)
        if custom:
            return custom
    template = _ALCHEMY_CHAIN_URLS.get(chain.key)
    if key and template:
        return template.format(key=key)
    return ""


def chain_rpc_url(chain: ChainConfig) -> str:
    direct = _rpc(chain.rpc_env)

    # Hub contract reads: official Robinhood RPC (reliable for eth_call / event logs)
    if chain.key == "robinhood_testnet" and direct:
        return direct

    alchemy = chain_alchemy_rpc_url(chain)
    if alchemy:
        return alchemy

    if direct:
        return direct

    return ""


def load_hub_addresses() -> dict:
    path = ROOT / "docs" / "addresses.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
