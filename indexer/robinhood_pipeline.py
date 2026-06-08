"""Robinhood hub chain — CredFlow lending history + Alchemy wallet transfers."""

import logging
import os
from datetime import datetime

import requests
from dotenv import load_dotenv
from web3 import Web3

from indexer.chains import chain_alchemy_rpc_url, chain_rpc_url, hub_chain, load_hub_addresses
from indexer.scoring_metrics import compute_protocol_metrics

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

_TRANSFER_CATEGORIES = ["external", "erc20", "erc721", "erc1155"]
_ZERO_ADDR = "0x0000000000000000000000000000000000000000"


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def _web3() -> Web3 | None:
    rpc = chain_rpc_url(hub_chain())
    if not rpc:
        return None
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60}))
    return w3 if w3.is_connected() else None


def _tx_hash_hex(value) -> str:
    if hasattr(value, "hex"):
        return value.hex()
    return str(value)


def _alchemy_asset_transfers(
    rpc_url: str,
    wallet_address: str,
    *,
    from_address: bool = False,
    to_address: bool = False,
    max_pages: int = 20,
) -> list[dict]:
    """
    Paginated alchemy_getAssetTransfers (same strategy as scripts/robinhoodtx.js).
    """
    if "alchemy.com" not in rpc_url:
        return []

    checksum = Web3.to_checksum_address(wallet_address)
    transfers: list[dict] = []
    page_key = None
    pages = 0

    while pages < max_pages:
        params: dict = {
            "fromBlock": "0x0",
            "toBlock": "latest",
            "category": _TRANSFER_CATEGORIES,
            "withMetadata": True,
            "excludeZeroValue": False,
            "maxCount": "0x3e8",
            "order": "asc",
        }
        if from_address:
            params["fromAddress"] = checksum
        if to_address:
            params["toAddress"] = checksum
        if page_key:
            params["pageKey"] = page_key

        try:
            response = requests.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "method": "alchemy_getAssetTransfers",
                    "params": [params],
                    "id": 1,
                },
                timeout=60,
            )
            result = response.json().get("result", {}) or {}
        except Exception as exc:
            logger.warning("Robinhood Alchemy transfers failed: %s", exc)
            break

        transfers.extend(result.get("transfers") or [])
        page_key = result.get("pageKey")
        pages += 1
        if not page_key:
            break

    return transfers


def _hub_alchemy_transfers(wallet_address: str) -> list[dict]:
    """Outgoing + incoming transfers on Robinhood hub via Alchemy."""
    rpc_url = chain_alchemy_rpc_url(hub_chain())
    if not rpc_url:
        return []

    outgoing = _alchemy_asset_transfers(rpc_url, wallet_address, from_address=True)
    incoming = _alchemy_asset_transfers(rpc_url, wallet_address, to_address=True)
    return outgoing + incoming


def _transfer_block_num(transfer: dict) -> int:
    raw = transfer.get("blockNum") or 0
    if isinstance(raw, str):
        return int(raw, 16) if raw.startswith("0x") else int(raw or 0)
    return int(raw or 0)


def _transfer_timestamp(transfer: dict) -> float | None:
    cached = transfer.get("_block_timestamp")
    if cached is not None:
        return float(cached)

    meta = transfer.get("metadata") or {}
    block_ts = meta.get("blockTimestamp")
    if not block_ts:
        return None
    try:
        return datetime.fromisoformat(str(block_ts).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _enrich_transfer_timestamps(w3: Web3 | None, transfers: list[dict]) -> None:
    """Robinhood Alchemy often omits metadata.blockTimestamp — resolve via eth_getBlock."""
    if not w3:
        return

    block_cache: dict[int, float] = {}
    for transfer in transfers:
        if _transfer_timestamp(transfer) is not None:
            continue
        block_num = _transfer_block_num(transfer)
        if not block_num:
            continue
        if block_num not in block_cache:
            try:
                block_cache[block_num] = float(w3.eth.get_block(block_num)["timestamp"])
            except Exception:
                continue
        transfer["_block_timestamp"] = block_cache[block_num]


def _wallet_transfer_features(wallet_address: str, transfers: list[dict]) -> dict:
    """Derive hub wallet timestamps + counterparties from Alchemy transfers."""
    checksum = Web3.to_checksum_address(wallet_address).lower()
    timestamps: list[float] = []
    unique_contracts: set[str] = set()

    for transfer in transfers:
        ts = _transfer_timestamp(transfer)
        if ts is not None:
            timestamps.append(ts)

        frm = (transfer.get("from") or "").lower()
        to = (transfer.get("to") or "").lower()
        if frm == checksum and to and to not in {checksum, _ZERO_ADDR}:
            unique_contracts.add(to)
        if to == checksum and frm and frm not in {checksum, _ZERO_ADDR}:
            unique_contracts.add(frm)

    return {
        "transfer_timestamps": timestamps,
        "unique_contract_addresses": sorted(unique_contracts),
        "unique_protocols": len(unique_contracts),
        "transfer_count": len(transfers),
    }


def _fetch_lending_events(w3: Web3, contract, wallet_address: str) -> tuple[list, list, list]:
    """Loan events for this borrower (CredFlowLending has low event volume on testnet)."""
    wallet_lower = Web3.to_checksum_address(wallet_address).lower()
    created = [
        e
        for e in contract.events.LoanCreated.get_logs(from_block=0)
        if e["args"]["borrower"].lower() == wallet_lower
    ]
    repaid = [
        e
        for e in contract.events.LoanRepaid.get_logs(from_block=0)
        if e["args"]["borrower"].lower() == wallet_lower
    ]
    liquidated = [
        e
        for e in contract.events.LoanLiquidated.get_logs(from_block=0)
        if e["args"]["borrower"].lower() == wallet_lower
    ]
    return created, repaid, liquidated


def _lending_activity_row(w3: Web3, evt: dict, action: str, asset: str = "usdg") -> dict:
    block = int(evt["blockNumber"])
    ts = float(w3.eth.get_block(block)["timestamp"])
    return {
        "hash": _tx_hash_hex(evt["transactionHash"]),
        "action": action,
        "block": block,
        "timestamp": ts,
        "asset": asset,
        "chain": hub_chain().key,
    }


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
    if not w3:
        logger.warning("Robinhood RPC unavailable for lending features")
        return {}

    try:
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(lending_addr),
            abi=LENDING_ABI,
        )
        created, repaid, liquidated = _fetch_lending_events(w3, contract, wallet_address)

        if not created and not repaid and not liquidated:
            return {}

        activity_rows = [
            _lending_activity_row(w3, evt, "Borrow") for evt in created
        ] + [
            _lending_activity_row(w3, evt, "Repay") for evt in repaid
        ] + [
            _lending_activity_row(w3, evt, "Liquidation") for evt in liquidated
        ]
        activity_rows.sort(key=lambda row: row.get("block", 0))

        borrow_amounts = [float(w3.from_wei(e["args"]["amount"], "mwei")) for e in created]
        durations = []
        for create_evt in created:
            loan_id = create_evt["args"]["loanId"]
            repay_evt = next((e for e in repaid if e["args"]["loanId"] == loan_id), None)
            if repay_evt:
                start_block = w3.eth.get_block(create_evt["blockNumber"])
                end_block = w3.eth.get_block(repay_evt["blockNumber"])
                durations.append((end_block["timestamp"] - start_block["timestamp"]) / 86400)

        avg_duration = sum(durations) / len(durations) if durations else 30.0
        protocol_metrics = compute_protocol_metrics(activity_rows, "credflow")

        return {
            "chain": hub_chain().key,
            "protocol": "credflow",
            **protocol_metrics,
            "avg_loan_duration": avg_duration,
            "activity_rows": activity_rows,
            "max_borrow_usd": max(borrow_amounts) if borrow_amounts else float(len(created)),
            "backend": "rpc_events",
        }
    except Exception as exc:
        logger.warning("CredFlow lending fetch failed for %s: %s", wallet_address, exc)
        return {}


def fetch_robinhood_wallet_features(wallet_address: str) -> dict:
    """
    Hub wallet stats: Alchemy transfer index (scripts/robinhoodtx.js) + direct RPC nonce.
    """
    if _use_mock_data():
        return {}

    checksum = Web3.to_checksum_address(wallet_address)
    transfers = _hub_alchemy_transfers(wallet_address)

    w3 = _web3()
    _enrich_transfer_timestamps(w3, transfers)
    transfer_features = _wallet_transfer_features(wallet_address, transfers)
    tx_count = 0
    if w3:
        try:
            tx_count = w3.eth.get_transaction_count(checksum)
        except Exception as exc:
            logger.warning("Robinhood nonce lookup failed: %s", exc)

    if tx_count == 0 and not transfers:
        return {}

    timestamps = transfer_features["transfer_timestamps"]
    unique_contracts = transfer_features["unique_contract_addresses"]

    result = {
        "chain": hub_chain().key,
        "tx_count": tx_count or transfer_features["transfer_count"],
        "unique_protocols": transfer_features["unique_protocols"] or min(tx_count or 1, 1),
        "unique_contract_addresses": unique_contracts,
        "transfer_timestamps": timestamps,
        "backend": "alchemy_transfers" if transfers else "rpc",
    }

    if timestamps:
        result["wallet_first_seen"] = datetime.utcfromtimestamp(min(timestamps)).isoformat()
        result["wallet_last_active"] = datetime.utcfromtimestamp(max(timestamps)).isoformat()
    elif w3:
        try:
            latest = w3.eth.get_block("latest")
            result["wallet_last_active"] = datetime.utcfromtimestamp(latest["timestamp"]).isoformat()
        except Exception:
            pass

    return result
