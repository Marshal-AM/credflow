"""Multi-chain wallet state via RPC — hub, spokes, and optional reputation chain."""

import logging
import os

import requests
from dotenv import load_dotenv
from web3 import Web3

from indexer.chains import active_rpc_chains, chain_alchemy_rpc_url, chain_rpc_url

load_dotenv()

logger = logging.getLogger(__name__)


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def fetch_chain_state(chain, wallet_address: str) -> dict:
    # Prefer Alchemy when available (indexed token balances + transfers)
    url = chain_alchemy_rpc_url(chain) or chain_rpc_url(chain)
    if not url:
        return {}

    try:
        w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 30}))
        if not w3.is_connected():
            return {}

        checksum = Web3.to_checksum_address(wallet_address)
        eth_balance = w3.eth.get_balance(checksum)
        tx_count = w3.eth.get_transaction_count(checksum)

        recent_txs = []
        token_balances = {}
        if "alchemy.com" in url:
            response = requests.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "method": "alchemy_getTokenBalances",
                    "params": [checksum],
                    "id": 1,
                },
                timeout=30,
            )
            token_balances = response.json().get("result", {})

            tx_response = requests.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "method": "alchemy_getAssetTransfers",
                    "params": [
                        {
                            "fromAddress": checksum,
                            "maxCount": "0x32",
                            "category": ["external", "erc20", "erc721"],
                        }
                    ],
                    "id": 1,
                },
                timeout=30,
            )
            outbound_txs = tx_response.json().get("result", {}).get("transfers", [])

            incoming_response = requests.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "method": "alchemy_getAssetTransfers",
                    "params": [
                        {
                            "toAddress": checksum,
                            "maxCount": "0x32",
                            "category": ["external", "erc20", "erc721"],
                        }
                    ],
                    "id": 2,
                },
                timeout=30,
            )
            incoming_txs = incoming_response.json().get("result", {}).get("transfers", [])
            recent_txs = outbound_txs + incoming_txs

        return {
            "chain": chain.key,
            "_rpc": url,
            "eth_balance_wei": eth_balance,
            "tx_count": tx_count,
            "token_balances": token_balances,
            "recent_transactions": recent_txs,
        }
    except Exception as exc:
        logger.warning("RPC wallet state failed on %s for %s: %s", chain.key, wallet_address, exc)
        return {}


def _merge_chain_states(per_chain: list[dict]) -> dict:
    rows = [row for row in per_chain if row]
    if not rows:
        return {
            "eth_balance_wei": 0,
            "tx_count": 0,
            "token_balances": {},
            "recent_transactions": [],
            "chains": [],
        }

    return {
        "eth_balance_wei": sum(int(row.get("eth_balance_wei", 0) or 0) for row in rows),
        "tx_count": sum(int(row.get("tx_count", 0) or 0) for row in rows),
        "token_balances": {row["chain"]: row.get("token_balances", {}) for row in rows},
        "recent_transactions": [
            {**tx, "chain": row["chain"]}
            for row in rows
            for tx in row.get("recent_transactions", [])
        ],
        "chains": [row["chain"] for row in rows if row.get("tx_count")],
    }


def get_wallet_state(wallet_address: str) -> dict:
    """Aggregate wallet state across all CredFlow chains (+ optional mainnet reputation)."""
    if _use_mock_data():
        from indexer.mock_data import mock_alchemy_state

        return mock_alchemy_state()

    per_chain = [fetch_chain_state(chain, wallet_address) for chain in active_rpc_chains()]
    return _merge_chain_states(per_chain)


def setup_webhook(wallet_address: str, webhook_url: str) -> dict:
    """Subscribe to wallet activity for Portfolio Monitor Agent (Phase 3)."""
    key = os.environ.get("ALCHEMY_API_KEY")
    if not key:
        raise ValueError("ALCHEMY_API_KEY not set")

    response = requests.post(
        "https://dashboard.alchemy.com/api/create-webhook",
        headers={"X-Alchemy-Token": key},
        json={
            "network": "ARB_MAINNET",
            "webhook_type": "ADDRESS_ACTIVITY",
            "webhook_url": webhook_url,
            "addresses": [wallet_address],
        },
        timeout=30,
    )
    return response.json()
