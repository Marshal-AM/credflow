"""Robinhood hub chain — CredFlow lending history + RPC wallet stats."""

import logging
import os

from dotenv import load_dotenv
from web3 import Web3

from indexer.chains import chain_rpc_url, hub_chain, load_hub_addresses

load_dotenv()

logger = logging.getLogger(__name__)

LENDING_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "loanId", "type": "uint256"},
            {"indexed": False, "name": "borrower", "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
            {"indexed": False, "name": "ltv", "type": "uint256"},
        ],
        "name": "LoanCreated",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "loanId", "type": "uint256"},
            {"indexed": False, "name": "borrower", "type": "address"},
            {"indexed": False, "name": "totalRepaid", "type": "uint256"},
        ],
        "name": "LoanRepaid",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "loanId", "type": "uint256"},
            {"indexed": False, "name": "borrower", "type": "address"},
            {"indexed": False, "name": "recovered", "type": "uint256"},
        ],
        "name": "LoanLiquidated",
        "type": "event",
    },
]


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def _web3() -> Web3 | None:
    rpc = chain_rpc_url(hub_chain())
    if not rpc:
        return None
    return Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))


def fetch_credflow_lending_features(wallet_address: str) -> dict:
    """Read CredFlowLending events on Robinhood hub for this borrower."""
    if _use_mock_data():
        return {}

    addresses = load_hub_addresses()
    lending_addr = addresses.get("lending") or os.environ.get("CREDFLOW_LENDING_ADDRESS")
    if not lending_addr:
        logger.warning("CredFlow lending address not configured")
        return {}

    w3 = _web3()
    if not w3 or not w3.is_connected():
        logger.warning("Robinhood RPC unavailable for lending features")
        return {}

    try:
        checksum = Web3.to_checksum_address(wallet_address)
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(lending_addr),
            abi=LENDING_ABI,
        )

        created = [
            e
            for e in contract.events.LoanCreated.get_logs(from_block=0)
            if e["args"]["borrower"].lower() == checksum.lower()
        ]
        repaid = [
            e
            for e in contract.events.LoanRepaid.get_logs(from_block=0)
            if e["args"]["borrower"].lower() == checksum.lower()
        ]
        liquidated = [
            e
            for e in contract.events.LoanLiquidated.get_logs(from_block=0)
            if e["args"]["borrower"].lower() == checksum.lower()
        ]

        if not created and not repaid and not liquidated:
            return {}

        borrow_amounts = [float(w3.from_wei(e["args"]["amount"], "mwei")) for e in created]
        durations = []
        for create_evt in created:
            loan_id = create_evt["args"]["loanId"]
            repay_evt = next((e for e in repaid if e["args"]["loanId"] == loan_id), None)
            if repay_evt:
                start_block = w3.eth.get_block(create_evt["blockNumber"])
                end_block = w3.eth.get_block(repay_evt["blockNumber"])
                durations.append((end_block["timestamp"] - start_block["timestamp"]) / 86400)

        return {
            "chain": hub_chain().key,
            "total_borrows": len(created),
            "on_time_repayments": len(repaid),
            "liquidation_count": len(liquidated),
            "avg_loan_duration": sum(durations) / len(durations) if durations else 30.0,
            "max_borrow_usd": max(borrow_amounts) if borrow_amounts else 0.0,
        }
    except Exception as exc:
        logger.warning("CredFlow lending fetch failed for %s: %s", wallet_address, exc)
        return {}


def fetch_robinhood_wallet_features(wallet_address: str) -> dict:
    """RPC wallet stats on Robinhood hub (Dune does not index this chain)."""
    if _use_mock_data():
        return {}

    w3 = _web3()
    if not w3 or not w3.is_connected():
        return {}

    try:
        checksum = Web3.to_checksum_address(wallet_address)
        tx_count = w3.eth.get_transaction_count(checksum)
        if tx_count == 0:
            return {}

        latest = w3.eth.get_block("latest")
        return {
            "chain": hub_chain().key,
            "tx_count": tx_count,
            "unique_protocols": min(tx_count, 3),
            "wallet_last_active": latest["timestamp"],
            "wallet_first_seen": latest["timestamp"],
        }
    except Exception as exc:
        logger.warning("Robinhood wallet RPC failed for %s: %s", wallet_address, exc)
        return {}
