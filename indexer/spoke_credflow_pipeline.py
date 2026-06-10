"""CredFlow spoke lending (Arbitrum + Base) — loan counter scan without eth_getLogs."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

from indexer.scoring_metrics import compute_protocol_metrics

load_dotenv()

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

LENDING_ABI = [
    {
        "name": "loanCounter",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "name": "loans",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "loanId", "type": "uint256"}],
        "outputs": [
            {"name": "borrower", "type": "address"},
            {"name": "collateralToken", "type": "address"},
            {"name": "collateralAmount", "type": "uint256"},
            {"name": "borrowedAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "startTime", "type": "uint256"},
            {"name": "dueTime", "type": "uint256"},
            {"name": "maxLTV", "type": "uint256"},
            {"name": "active", "type": "bool"},
        ],
    },
]

SPOKE_RPC = {
    "arbitrum": ("RPC_ARBITRUM_SEPOLIA", "ALCHEMY_ARBITRUM_SEPOLIA_RPC"),
    "base": ("RPC_BASE_SEPOLIA", "ALCHEMY_BASE_SEPOLIA_RPC"),
}

# indexer.chains uses arbitrum_sepolia / base_sepolia; address files use arbitrum / base.
CHAIN_KEY_ALIASES: dict[str, str] = {
    "arbitrum_sepolia": "arbitrum",
    "base_sepolia": "base",
}


def _normalize_spoke_chain_key(chain_key: str) -> str | None:
    key = chain_key.lower().strip()
    if key in SPOKE_RPC:
        return key
    return CHAIN_KEY_ALIASES.get(key)


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def _web3_for_chain(chain_key: str) -> Web3 | None:
    slug = _normalize_spoke_chain_key(chain_key)
    if not slug:
        return None
    primary, fallback = SPOKE_RPC[slug]
    rpc = os.environ.get(primary) or os.environ.get(fallback)
    if not rpc:
        return None
    w3 = Web3(Web3.HTTPProvider(rpc))
    return w3 if w3.is_connected() else None


def _load_spoke_addresses(chain_key: str) -> dict:
    slug = _normalize_spoke_chain_key(chain_key)
    if not slug:
        return {}
    fname = f"spoke-{slug}-addresses.json"
    path = ROOT / "docs" / fname
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fetch_spoke_credflow_lending_features(wallet_address: str, chain_key: str) -> dict:
    """Scan CredFlowSpokeLending loans by counter for one spoke chain."""
    if _use_mock_data():
        return {}

    slug = _normalize_spoke_chain_key(chain_key)
    if not slug:
        logger.warning("Unknown spoke chain key for CredFlow lending: %s", chain_key)
        return {}

    wallet = Web3.to_checksum_address(wallet_address)
    w3 = _web3_for_chain(chain_key)
    if not w3:
        logger.warning("Spoke CredFlow RPC unavailable for %s", chain_key)
        return {}

    addresses = _load_spoke_addresses(chain_key)
    lending_addr = addresses.get("lending")
    if not lending_addr:
        return {}

    try:
        lending = w3.eth.contract(
            address=Web3.to_checksum_address(lending_addr),
            abi=LENDING_ABI,
        )
        counter = int(lending.functions.loanCounter().call())
        activity_rows: list[dict] = []
        repay_count = 0
        on_time_count = 0

        for loan_id in range(1, counter + 1):
            loan = lending.functions.loans(loan_id).call()
            borrower = Web3.to_checksum_address(loan[0])
            if borrower.lower() != wallet.lower():
                continue
            start_ts = float(loan[5])
            due_ts = float(loan[6])
            active = bool(loan[8])
            activity_rows.append(
                {
                    "hash": f"{chain_key}-loan-{loan_id}",
                    "action": "Borrow",
                    "block": 0,
                    "timestamp": start_ts,
                    "asset": "usdc",
                    "chain": chain_key,
                }
            )
            if not active:
                repay_count += 1
                activity_rows.append(
                    {
                        "hash": f"{chain_key}-repay-{loan_id}",
                        "action": "Repay",
                        "block": 0,
                        "timestamp": due_ts,
                        "asset": "usdc",
                        "chain": chain_key,
                    }
                )
                on_time_count += 1

        borrow_count = len([r for r in activity_rows if r["action"] == "Borrow"])
        if borrow_count == 0:
            return {}

        protocol_metrics = compute_protocol_metrics(activity_rows, "credflow")
        return {
            "chain": chain_key,
            "protocol": "credflow",
            **protocol_metrics,
            "credflow_borrow_count": borrow_count,
            "credflow_repay_count": repay_count,
            "credflow_liquidation_count": 0,
            "on_time_repayments": on_time_count,
            "activity_rows": activity_rows,
            "max_borrow_usd": float(borrow_count),
            "backend": "rpc_loan_counter",
        }
    except Exception as exc:
        logger.warning("Spoke CredFlow lending fetch failed %s: %s", chain_key, exc)
        return {}


def fetch_all_spoke_credflow_lending_features(wallet_address: str) -> list[dict]:
    from indexer.chains import spoke_chains

    results = []
    for chain in spoke_chains():
        data = fetch_spoke_credflow_lending_features(wallet_address, chain.key)
        if data:
            results.append(data)
    return results
