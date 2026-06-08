"""RPC + Alchemy indexers for spoke testnets (Dune has no Sepolia schemas)."""

import logging
import os
from datetime import datetime

import requests
from web3 import Web3

from indexer.chains import chain_alchemy_rpc_url, chain_rpc_url, spoke_chains
from indexer.scoring_metrics import compute_protocol_metrics

logger = logging.getLogger(__name__)

# Aave V3 Base Sepolia Pool — bgd-labs/aave-address-book
AAVE_POOL_ABI = [
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "getUserAccountData",
        "outputs": [
            {"name": "totalCollateralBase", "type": "uint256"},
            {"name": "totalDebtBase", "type": "uint256"},
            {"name": "availableBorrowsBase", "type": "uint256"},
            {"name": "currentLiquidationThreshold", "type": "uint256"},
            {"name": "ltv", "type": "uint256"},
            {"name": "healthFactor", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
]

SPOKE_AAVE_POOLS = {
    "arbitrum_sepolia": "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff",
    "base_sepolia": "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
}

# Known reserve assets per spoke (bgd-labs/aave-address-book)
SPOKE_AAVE_ASSETS = {
    # Base Sepolia
    "0x4200000000000000000000000000000000000006": "weth",
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e": "usdc",
    # Arbitrum Sepolia
    "0x1df462e2712496373a347f8ad10802a5e95f053d": "weth",
    "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": "usdc",
}

# Aave V3 Pool event topic0 → action (mirrors scripts/aavefetch.js)
AAVE_EVENT_TOPICS = {
    "0xde6857219544bb5b7746f48ed30be6386fefc61ebafb8a5e7e5a0cf22b025b5e": "Supply",
    "0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7": "Withdraw",
    "0xb3d084820fb1a9decffb176436bd02b9f48dd2df1bd1977aa3d02e9d0a5b2e46": "Borrow",
    "0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa": "Repay",
    "0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd": "FlashLoan",
    "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286": "Liquidation",
}

# Function selector fallback when logs are sparse
AAVE_SELECTORS = {
    "0x617ba037": "Supply",
    "0x69328dec": "Withdraw",
    "0xa415bcad": "Borrow",
    "0x573ade81": "Repay",
    "0xab9c4b5d": "FlashLoan",
    "0x00a718a9": "Liquidation",
}


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def _direct_rpc_url(chain) -> str:
    return os.environ.get(chain.rpc_env, "").strip()


def _web3_for_chain(chain) -> Web3 | None:
    """Prefer chain-native RPC for receipts/logs; fall back to Alchemy."""
    rpc = _direct_rpc_url(chain) or chain_alchemy_rpc_url(chain) or chain_rpc_url(chain)
    if not rpc:
        return None
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 60}))
    return w3 if w3.is_connected() else None


def _resolve_aave_asset(transfer: dict) -> str:
    raw = (transfer.get("rawContract") or {}).get("address") or transfer.get("asset") or ""
    if isinstance(raw, str) and raw.lower().startswith("0x"):
        return SPOKE_AAVE_ASSETS.get(raw.lower(), raw.lower())
    if isinstance(raw, str) and raw:
        return raw.lower()
    return "unknown"


def _alchemy_rpc(method: str, params: list, rpc_url: str):
    response = requests.post(
        rpc_url,
        json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1},
        timeout=60,
    )
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(f"Alchemy {method}: {payload['error']}")
    return payload.get("result")


def _fetch_wallet_pool_transfers(rpc_url: str, wallet: str, pool: str) -> list[dict]:
    """
    Alchemy getAssetTransfers: wallet → Aave pool (same as scripts/aavefetch.js).

    Indexed by Alchemy — no block-range log scanning required.
    """
    if "alchemy.com" not in rpc_url:
        return []

    wallet_cs = Web3.to_checksum_address(wallet)
    pool_cs = Web3.to_checksum_address(pool)
    transfers: list[dict] = []
    page_key = None

    while True:
        params = {
            "fromBlock": "0x0",
            "toBlock": "latest",
            "fromAddress": wallet_cs,
            "toAddress": pool_cs,
            "category": ["external"],
            "withMetadata": True,
            "excludeZeroValue": False,
            "maxCount": "0x3e8",
        }
        if page_key:
            params["pageKey"] = page_key

        result = _alchemy_rpc("alchemy_getAssetTransfers", [params], rpc_url)
        transfers.extend(result.get("transfers") or [])
        page_key = result.get("pageKey")
        if not page_key:
            break

    logger.info("Aave Alchemy transfers wallet→pool: %s txs", len(transfers))
    return transfers


def _topic_hex(topic) -> str:
    raw = topic.hex() if hasattr(topic, "hex") else str(topic)
    return raw if raw.startswith("0x") else f"0x{raw}"


def _input_selector(tx_input) -> str:
    if not tx_input:
        return ""
    if isinstance(tx_input, (bytes, bytearray)):
        return f"0x{tx_input[:4].hex()}"
    text = str(tx_input)
    return text[:10].lower() if text.startswith("0x") else f"0x{text[:8].lower()}"


def _action_from_logs(logs: list, pool_lower: str) -> str | None:
    for log in logs:
        if log.get("address", "").lower() != pool_lower:
            continue
        topics = log.get("topics") or []
        if topics:
            action = AAVE_EVENT_TOPICS.get(_topic_hex(topics[0]).lower())
            if action:
                return action
    return None


def _action_from_input(tx_input) -> str:
    selector = _input_selector(tx_input)
    if len(selector) < 10:
        return "Unknown"
    return AAVE_SELECTORS.get(selector, "Unknown")


def _parse_aave_activity(
    w3: Web3,
    transfers: list[dict],
    pool_address: str,
    chain_key: str,
) -> list[dict]:
    """Fetch receipts for pool txs and classify Supply/Borrow/Repay/Liquidation."""
    pool_lower = pool_address.lower()
    hashes = list(dict.fromkeys(t.get("hash") for t in transfers if t.get("hash")))
    rows: list[dict] = []

    for tx_hash in hashes:
        receipt = w3.eth.get_transaction_receipt(tx_hash)
        tx = w3.eth.get_transaction(tx_hash)
        pool_logs = [
            {
                "address": log["address"],
                "topics": log["topics"],
            }
            for log in receipt.get("logs", [])
            if log["address"].lower() == pool_lower
        ]
        action = _action_from_logs(pool_logs, pool_lower) or _action_from_input(tx.get("input"))
        transfer = next((t for t in transfers if t.get("hash") == tx_hash), {})
        asset = _resolve_aave_asset(transfer)
        meta = transfer.get("metadata") or {}
        block_num = receipt.get("blockNumber", 0)
        block_ts = None
        if meta.get("blockTimestamp"):
            try:
                block_ts = datetime.fromisoformat(
                    meta["blockTimestamp"].replace("Z", "+00:00")
                ).timestamp()
            except ValueError:
                pass
        if block_ts is None and block_num:
            block_ts = w3.eth.get_block(block_num)["timestamp"]

        rows.append(
            {
                "hash": tx_hash,
                "action": action,
                "block": block_num,
                "timestamp": block_ts,
                "asset": asset,
                "chain": chain_key,
            }
        )

    rows.sort(key=lambda r: r["block"], reverse=True)
    logger.info(
        "Aave parsed activity: %s",
        {a: sum(1 for r in rows if r["action"] == a) for a in set(r["action"] for r in rows)},
    )
    return rows


def _current_aave_position(pool, wallet_address: str) -> dict:
    try:
        data = pool.functions.getUserAccountData(Web3.to_checksum_address(wallet_address)).call()
        collateral = int(data[0])
        debt = int(data[1])
        return {
            "total_collateral_base": collateral,
            "total_debt_base": debt,
            "health_factor_raw": int(data[5]),
            "has_active_position": collateral > 0 or debt > 0,
        }
    except Exception as exc:
        logger.warning("getUserAccountData failed: %s", exc)
        return {}


def _alchemy_transfers(rpc_url: str, wallet_address: str, *, max_pages: int = 20) -> list:
    """Paginated outbound transfers with block timestamps (for wallet age + protocol diversity)."""
    if "alchemy.com" not in rpc_url:
        return []
    try:
        checksum = Web3.to_checksum_address(wallet_address)
        transfers: list[dict] = []
        page_key = None
        pages = 0
        while pages < max_pages:
            params: dict = {
                "fromAddress": checksum,
                "maxCount": "0x3e8",
                "category": ["external", "erc20", "erc721", "erc1155"],
                "withMetadata": True,
            }
            if page_key:
                params["pageKey"] = page_key
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
            transfers.extend(result.get("transfers") or [])
            page_key = result.get("pageKey")
            pages += 1
            if not page_key:
                break
        return transfers
    except Exception as exc:
        logger.warning("Alchemy transfers failed: %s", exc)
        return []


def fetch_spoke_wallet_features(chain, wallet_address: str) -> dict:
    if _use_mock_data():
        return {}

    w3 = _web3_for_chain(chain)
    if not w3:
        return {}

    try:
        checksum = Web3.to_checksum_address(wallet_address)
        tx_count = w3.eth.get_transaction_count(checksum)
        if tx_count == 0:
            return {}

        alchemy_rpc = chain_alchemy_rpc_url(chain)
        transfers = _alchemy_transfers(alchemy_rpc, wallet_address) if alchemy_rpc else []
        unique_to = {
            t.get("to").lower()
            for t in transfers
            if t.get("to") and t.get("to").lower() != checksum.lower()
        }

        timestamps = []
        for t in transfers:
            meta = t.get("metadata") or {}
            block_ts = meta.get("blockTimestamp")
            if block_ts:
                try:
                    timestamps.append(
                        datetime.fromisoformat(block_ts.replace("Z", "+00:00")).timestamp()
                    )
                except ValueError:
                    pass

        result = {
            "chain": chain.key,
            "tx_count": tx_count,
            "unique_protocols": len(unique_to) if unique_to else min(tx_count, 1),
            "unique_contract_addresses": list(unique_to),
            "transfer_timestamps": timestamps,
        }
        if timestamps:
            result["wallet_first_seen"] = datetime.utcfromtimestamp(min(timestamps)).isoformat()
            result["wallet_last_active"] = datetime.utcfromtimestamp(max(timestamps)).isoformat()
        else:
            latest = w3.eth.get_block("latest")
            result["wallet_last_active"] = datetime.utcfromtimestamp(latest["timestamp"]).isoformat()
        return result
    except Exception as exc:
        logger.warning("Spoke wallet RPC failed on %s for %s: %s", chain.key, wallet_address, exc)
        return {}


def _activity_to_borrow_features(rows: list[dict], position: dict, pool_addr: str, chain_key: str) -> dict:
    """Map parsed Aave actions → aave_* protocol features (docs/factors.md)."""
    has_position = position.get("has_active_position", False)
    protocol_metrics = compute_protocol_metrics(rows, "aave")

    if not protocol_metrics["aave_borrow_count"] and has_position:
        protocol_metrics["aave_borrow_count"] = 1
    if (
        not protocol_metrics["aave_repay_count"]
        and has_position
        and position.get("total_debt_base", 0) == 0
    ):
        protocol_metrics["aave_repay_count"] = 1

    return {
        "chain": chain_key,
        "pool": pool_addr,
        "protocol": "aave",
        **protocol_metrics,
        "max_borrow_usd": float(protocol_metrics["aave_borrow_count"] or 0),
        "current_position": position,
        "activity_rows": rows,
        "backend": "alchemy_transfers+receipt_logs",
    }


def fetch_aave_spoke_features(wallet_address: str) -> list[dict]:
    """
    Aave V3 activity on spoke testnets.

    Uses the same strategy as scripts/aavefetch.js:
    1. alchemy_getAssetTransfers(wallet → pool) — fast indexed lookup
    2. eth_getTransactionReceipt per tx — parse pool event topics
    3. getUserAccountData — current collateral/debt snapshot
    """
    if _use_mock_data():
        return []

    per_chain = []

    for chain in spoke_chains():
        pool_addr = SPOKE_AAVE_POOLS.get(chain.key)
        if not pool_addr:
            continue

        w3 = _web3_for_chain(chain)
        if not w3:
            logger.warning("Aave %s: no RPC connection", chain.key)
            continue

        alchemy_rpc = chain_alchemy_rpc_url(chain)
        if not alchemy_rpc:
            logger.warning(
                "Aave %s: set ALCHEMY_API_KEY for indexed transfer fetch (see scripts/arbitrum-sepolia-aave.js)",
                chain.key,
            )
            continue

        try:
            pool = w3.eth.contract(
                address=Web3.to_checksum_address(pool_addr),
                abi=AAVE_POOL_ABI,
            )
            position = _current_aave_position(pool, wallet_address)
            transfers = _fetch_wallet_pool_transfers(alchemy_rpc, wallet_address, pool_addr)

            if not transfers and not position.get("has_active_position"):
                logger.info("Aave %s: no pool txs and no active position", chain.key)
                continue

            rows = (
                _parse_aave_activity(w3, transfers, pool_addr, chain.key) if transfers else []
            )
            per_chain.append(_activity_to_borrow_features(rows, position, pool_addr, chain.key))
            logger.info(
                "Aave %s: supply=%s borrow=%s repay=%s rows=%s",
                chain.key,
                sum(1 for r in rows if r.get("action") == "Supply"),
                sum(1 for r in rows if r.get("action") == "Borrow"),
                sum(1 for r in rows if r.get("action") == "Repay"),
                len(rows),
            )
        except Exception as exc:
            logger.warning("Aave fetch failed on %s for %s: %s", chain.key, wallet_address, exc)

    return per_chain
