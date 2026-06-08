"""CredFlow supported chains — hub, spokes, and optional reputation sources."""

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
    role: str  # hub | spoke | reputation
    rpc_env: str
    dune_transactions_table: str | None = None
    dune_lending_blockchain: str | None = None
    alchemy_rpc_env: str | None = None


def _rpc(env_key: str, default: str = "") -> str:
    return os.environ.get(env_key, default).strip()


# Hub + LayerZero spokes (see layerzero/config.json)
CREDFLOW_CHAINS: List[ChainConfig] = [
    ChainConfig(
        key="robinhood_testnet",
        chain_id=46630,
        role="hub",
        rpc_env="RPC_ROBINHOOD",
    ),
    ChainConfig(
        key="arbitrum_sepolia",
        chain_id=421614,
        role="spoke",
        rpc_env="RPC_ARBITRUM_SEPOLIA",
        dune_transactions_table="arbitrum_sepolia.transactions",
        dune_lending_blockchain="arbitrum",
        alchemy_rpc_env="ALCHEMY_ARBITRUM_SEPOLIA_RPC",
    ),
    ChainConfig(
        key="base_sepolia",
        chain_id=84532,
        role="spoke",
        rpc_env="RPC_BASE_SEPOLIA",
        dune_transactions_table="base_sepolia.transactions",
        dune_lending_blockchain="base",
        alchemy_rpc_env="ALCHEMY_BASE_SEPOLIA_RPC",
    ),
]

# GMX only exists on Arbitrum mainnet — optional cross-chain trading reputation
GMX_REPUTATION_CHAIN = ChainConfig(
    key="arbitrum_mainnet",
    chain_id=42161,
    role="reputation",
    rpc_env="ALCHEMY_ARBITRUM_RPC",
    dune_transactions_table="arbitrum.transactions",
    dune_lending_blockchain="arbitrum",
)


def hub_chain() -> ChainConfig:
    return CREDFLOW_CHAINS[0]


def spoke_chains() -> List[ChainConfig]:
    return [c for c in CREDFLOW_CHAINS if c.role == "spoke"]


def dune_wallet_chains() -> List[ChainConfig]:
    return [c for c in CREDFLOW_CHAINS if c.dune_transactions_table]


def dune_lending_blockchains() -> List[str]:
    chains = []
    for chain in CREDFLOW_CHAINS:
        if chain.dune_lending_blockchain and chain.dune_lending_blockchain not in chains:
            chains.append(chain.dune_lending_blockchain)
    if os.environ.get("INDEX_ARBITRUM_MAINNET", "1") == "1":
        mainnet = GMX_REPUTATION_CHAIN.dune_lending_blockchain
        if mainnet and mainnet not in chains:
            chains.append(mainnet)
    return chains


def chain_rpc_url(chain: ChainConfig) -> str:
    if chain.alchemy_rpc_env:
        custom = _rpc(chain.alchemy_rpc_env)
        if custom:
            return custom

    direct = _rpc(chain.rpc_env)
    if direct:
        return direct

    key = os.environ.get("ALCHEMY_API_KEY", "").strip()
    if not key:
        return ""

    defaults = {
        "robinhood_testnet": f"https://robinhood-testnet.g.alchemy.com/v2/{key}",
        "arbitrum_sepolia": f"https://arb-sepolia.g.alchemy.com/v2/{key}",
        "base_sepolia": f"https://base-sepolia.g.alchemy.com/v2/{key}",
        "arbitrum_mainnet": f"https://arb-mainnet.g.alchemy.com/v2/{key}",
    }
    return defaults.get(chain.key, "")


def load_hub_addresses() -> dict:
    path = ROOT / "docs" / "addresses.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
