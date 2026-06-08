"""Morpho Blue borrow activity indexer — Base Sepolia only."""

import logging
import os
import time

import requests
from web3 import Web3

from indexer.chains import morpho_spoke_chains
from indexer.scoring_metrics import compute_protocol_metrics
from indexer.spoke_pipeline import SPOKE_AAVE_ASSETS, _topic_hex, _web3_for_chain

logger = logging.getLogger(__name__)

MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"

# Base Sepolia collateral / loan tokens (CredFlow morpho market)
MORPHO_COLLATERAL_TOKEN = "0x4200000000000000000000000000000000000006"
MORPHO_LOAN_TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"

ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api"
REQUEST_DELAY_SEC = 0.35

_CHAIN_IDS = {
    "base_sepolia": 84532,
}

MORPHO_ABI = [
    {
        "inputs": [
            {"name": "id", "type": "bytes32"},
            {"name": "user", "type": "address"},
        ],
        "name": "position",
        "outputs": [
            {"name": "supplyShares", "type": "uint256"},
            {"name": "borrowShares", "type": "uint128"},
            {"name": "collateral", "type": "uint128"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "bytes32"},
            {"indexed": True, "name": "caller", "type": "address"},
            {"indexed": True, "name": "onBehalf", "type": "address"},
            {"indexed": False, "name": "assets", "type": "uint256"},
        ],
        "name": "SupplyCollateral",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "bytes32"},
            {"indexed": False, "name": "caller", "type": "address"},
            {"indexed": True, "name": "onBehalf", "type": "address"},
            {"indexed": True, "name": "receiver", "type": "address"},
            {"indexed": False, "name": "assets", "type": "uint256"},
        ],
        "name": "WithdrawCollateral",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "bytes32"},
            {"indexed": False, "name": "caller", "type": "address"},
            {"indexed": True, "name": "onBehalf", "type": "address"},
            {"indexed": True, "name": "receiver", "type": "address"},
            {"indexed": False, "name": "assets", "type": "uint256"},
            {"indexed": False, "name": "shares", "type": "uint256"},
        ],
        "name": "Borrow",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "bytes32"},
            {"indexed": True, "name": "caller", "type": "address"},
            {"indexed": True, "name": "onBehalf", "type": "address"},
            {"indexed": False, "name": "assets", "type": "uint256"},
            {"indexed": False, "name": "shares", "type": "uint256"},
        ],
        "name": "Repay",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "bytes32"},
            {
                "indexed": False,
                "name": "marketParams",
                "type": "tuple",
                "components": [
                    {"name": "loanToken", "type": "address"},
                    {"name": "collateralToken", "type": "address"},
                    {"name": "oracle", "type": "address"},
                    {"name": "irm", "type": "address"},
                    {"name": "lltv", "type": "uint256"},
                ],
            },
        ],
        "name": "CreateMarket",
        "type": "event",
    },
]

# event_name, action label, indexed topic position for wallet filter
_EVENT_TOPIC_QUERIES: list[tuple[str, str, int]] = [
    ("SupplyCollateral", "Supply", 1),
    ("SupplyCollateral", "Supply", 2),
    ("WithdrawCollateral", "Withdraw", 1),
    ("WithdrawCollateral", "Withdraw", 2),
    ("Borrow", "Borrow", 2),
    ("Borrow", "Borrow", 3),
    ("Repay", "Repay", 1),
    ("Repay", "Repay", 2),
]


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def _etherscan_api_key() -> str:
    return (os.environ.get("BASESCAN_API_KEY") or os.environ.get("ETHERSCAN_API_KEY") or "").strip()


def _morpho_deployed(w3: Web3) -> bool:
    try:
        code = w3.eth.get_code(Web3.to_checksum_address(MORPHO_BLUE))
        return code not in (b"", b"0x")
    except Exception:
        return False


def _market_id_hex(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "hex"):
        raw = value.hex()
        return raw if raw.startswith("0x") else f"0x{raw}"
    text = str(value)
    return text if text.startswith("0x") else f"0x{text}"


def _tx_hash_hex(value) -> str:
    if hasattr(value, "hex"):
        raw = value.hex()
        return raw if raw.startswith("0x") else f"0x{raw}"
    return str(value)


def _resolve_token_address(token_addr: str) -> str:
    return SPOKE_AAVE_ASSETS.get(token_addr.lower(), token_addr.lower())


# CredFlow Morpho test activity starts ~37M; override via MORPHO_FROM_BLOCK.
_MORPHO_FROM_BLOCK_DEFAULTS = {
    "base_sepolia": 37_000_000,
}


def _morpho_from_block(chain_key: str) -> int:
    override = os.environ.get("MORPHO_FROM_BLOCK", "").strip()
    if override:
        return int(override)
    return _MORPHO_FROM_BLOCK_DEFAULTS.get(chain_key, 0)


def _int_from_hex(value) -> int:
    if isinstance(value, int):
        return value
    if value is None or value == "":
        return 0
    text = str(value)
    if text.lower() == "0x":
        return 0
    return int(text, 16) if text.startswith("0x") else int(text)


def _etherscan_get_logs(chain_id: int, params: dict) -> list[dict]:
    """Fetch logs via Etherscan API V2 (same pattern as scripts/morphoDebug.js)."""
    api_key = _etherscan_api_key()
    if not api_key:
        raise RuntimeError("BASESCAN_API_KEY or ETHERSCAN_API_KEY required for Morpho indexing")

    query = {
        "chainid": str(chain_id),
        "module": "logs",
        "action": "getLogs",
        "fromBlock": str(params.pop("fromBlock", _morpho_from_block("base_sepolia"))),
        "toBlock": params.pop("toBlock", "latest"),
        "apikey": api_key,
        **params,
    }

    response = requests.get(ETHERSCAN_V2_URL, params=query, timeout=30)
    time.sleep(REQUEST_DELAY_SEC)
    response.raise_for_status()
    payload = response.json()

    if payload.get("status") != "1":
        err = payload.get("result") if isinstance(payload.get("result"), str) else payload.get("message")
        if err in ("No records found", "No transactions found") or payload.get("message") in (
            "No records found",
            "No transactions found",
        ):
            return []
        raise RuntimeError(f"Etherscan V2 getLogs failed: {err or payload.get('message') or 'unknown error'}")

    result = payload.get("result")
    if not isinstance(result, list):
        raise RuntimeError(f"Unexpected Etherscan result type: {type(result).__name__}")
    return result


def _wallet_topic(wallet_address: str) -> str:
    return "0x" + wallet_address.lower().removeprefix("0x").zfill(64)


def _log_to_web3_format(log: dict) -> dict:
    return {
        "address": log["address"],
        "topics": log["topics"],
        "data": log.get("data", "0x"),
        "blockNumber": _int_from_hex(log["blockNumber"]),
        "blockHash": log.get("blockHash") or ("0x" + "00" * 32),
        "transactionHash": log["transactionHash"],
        "transactionIndex": _int_from_hex(log.get("transactionIndex", 0)),
        "logIndex": _int_from_hex(log.get("logIndex", 0)),
        "removed": False,
    }


def _timestamp_from_log(log: dict, w3: Web3, block_cache: dict[int, float]) -> float:
    if log.get("timeStamp"):
        return float(_int_from_hex(log["timeStamp"]))
    block_num = _int_from_hex(log["blockNumber"])
    if block_num not in block_cache:
        block_cache[block_num] = float(w3.eth.get_block(block_num)["timestamp"])
    return block_cache[block_num]


def _fetch_market_params(chain_id: int, market_ids: list[str], morpho_contract) -> dict[str, dict]:
    """Resolve loan/collateral tokens from CreateMarket logs."""
    markets: dict[str, dict] = {}
    create_event = morpho_contract.events.CreateMarket()
    topic0 = _topic_hex(create_event.topic)

    for market_id in market_ids:
        if not market_id or market_id in markets:
            continue
        try:
            logs = _etherscan_get_logs(
                chain_id,
                {
                    "address": MORPHO_BLUE,
                    "topic0": topic0,
                    "topic1": market_id,
                    "topic0_1_opr": "and",
                    "page": "1",
                    "offset": "1",
                },
            )
        except Exception as exc:
            logger.warning("Morpho CreateMarket lookup failed for %s: %s", market_id, exc)
            continue

        if not logs:
            continue

        try:
            decoded = create_event.process_log(_log_to_web3_format(logs[0]))
            params = decoded["args"]["marketParams"]
            if hasattr(params, "loanToken"):
                loan_token = str(params.loanToken).lower()
                collateral_token = str(params.collateralToken).lower()
            else:
                loan_token = str(params[0]).lower()
                collateral_token = str(params[1]).lower()
            markets[market_id] = {
                "loanToken": loan_token,
                "collateralToken": collateral_token,
            }
        except Exception as exc:
            logger.warning("Morpho CreateMarket decode failed for %s: %s", market_id, exc)

    return markets


def _asset_for_action(action: str, market_id: str | None, markets: dict[str, dict]) -> str:
    market = markets.get(market_id or "", {})
    if market:
        token = market["collateralToken"] if action in ("Supply", "Withdraw") else market["loanToken"]
        return _resolve_token_address(token)
    if action in ("Supply", "Withdraw"):
        return _resolve_token_address(MORPHO_COLLATERAL_TOKEN)
    return _resolve_token_address(MORPHO_LOAN_TOKEN)


def _fetch_morpho_events(w3: Web3, wallet_address: str, chain_key: str) -> list[dict]:
    """Query Morpho Blue event logs via Etherscan V2 topic filters."""
    chain_id = _CHAIN_IDS.get(chain_key)
    if chain_id is None:
        logger.warning("Morpho: no Etherscan chain id for %s", chain_key)
        return []

    morpho = w3.eth.contract(
        address=Web3.to_checksum_address(MORPHO_BLUE),
        abi=MORPHO_ABI,
    )
    checksum = Web3.to_checksum_address(wallet_address)
    wallet_topic = _wallet_topic(checksum)
    from_block = _morpho_from_block(chain_key)

    seen: set[tuple] = set()
    parsed_rows: list[tuple[str, dict, dict]] = []

    for event_name, action, topic_index in _EVENT_TOPIC_QUERIES:
        event = getattr(morpho.events, event_name)
        topic0 = _topic_hex(event.topic)
        topic_key = f"topic{topic_index}"

        try:
            logs = _etherscan_get_logs(
                chain_id,
                {
                    "address": MORPHO_BLUE,
                    "fromBlock": str(from_block),
                    "topic0": topic0,
                    topic_key: wallet_topic,
                    f"topic0_{topic_index}_opr": "and",
                    "page": "1",
                    "offset": "1000",
                },
            )
        except Exception as exc:
            logger.warning("Morpho %s Etherscan query %s failed: %s", chain_key, event_name, exc)
            continue

        for log in logs:
            tx_hash = log.get("transactionHash", "")
            log_index = log.get("logIndex", "")
            dedupe_key = (tx_hash, str(log_index))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            try:
                decoded = event.process_log(_log_to_web3_format(log))
            except Exception as exc:
                logger.warning("Morpho log decode failed tx=%s: %s", tx_hash, exc)
                continue

            parsed_rows.append((action, decoded, log))

    market_ids = list(
        dict.fromkeys(
            _market_id_hex(decoded["args"].get("id"))
            for _action, decoded, _log in parsed_rows
            if decoded["args"].get("id") is not None
        )
    )
    markets = _fetch_market_params(chain_id, market_ids, morpho)

    block_cache: dict[int, float] = {}
    rows: list[dict] = []
    action_seen: set[tuple] = set()

    for action, decoded, log in parsed_rows:
        market_id = _market_id_hex(decoded["args"].get("id"))
        tx_hash = _tx_hash_hex(decoded["transactionHash"])
        dedupe_key = (tx_hash, action, market_id or "")
        if dedupe_key in action_seen:
            continue
        action_seen.add(dedupe_key)

        block_num = int(decoded["blockNumber"])
        rows.append(
            {
                "hash": tx_hash,
                "action": action,
                "block": block_num,
                "timestamp": _timestamp_from_log(log, w3, block_cache),
                "asset": _asset_for_action(action, market_id, markets),
                "chain": chain_key,
                "protocol": "morpho",
                "market_id": market_id,
            }
        )

    rows.sort(key=lambda r: r["block"], reverse=True)
    logger.info(
        "Morpho %s event logs: %s",
        chain_key,
        {a: sum(1 for r in rows if r["action"] == a) for a in set(r["action"] for r in rows)},
    )
    return rows


def _current_morpho_positions(morpho, wallet_address: str, market_ids: list[str]) -> dict:
    checksum = Web3.to_checksum_address(wallet_address)
    collateral = 0
    debt_shares = 0
    for market_id in market_ids:
        if not market_id:
            continue
        try:
            pos = morpho.functions.position(market_id, checksum).call()
            collateral += int(pos[2])
            debt_shares += int(pos[1])
        except Exception as exc:
            logger.warning("Morpho position(%s) failed: %s", market_id, exc)
    return {
        "collateral_raw": collateral,
        "borrow_shares_raw": debt_shares,
        "has_active_position": collateral > 0 or debt_shares > 0,
    }


def _activity_to_borrow_features(rows: list[dict], position: dict, morpho_addr: str, chain_key: str) -> dict:
    has_position = position.get("has_active_position", False)
    protocol_metrics = compute_protocol_metrics(rows, "morpho")

    if not protocol_metrics["morpho_borrow_count"] and has_position:
        protocol_metrics["morpho_borrow_count"] = 1
    if (
        not protocol_metrics["morpho_repay_count"]
        and has_position
        and position.get("borrow_shares_raw", 0) == 0
    ):
        protocol_metrics["morpho_repay_count"] = 1

    return {
        "chain": chain_key,
        "pool": morpho_addr,
        "protocol": "morpho",
        **protocol_metrics,
        "max_borrow_usd": float(protocol_metrics["morpho_borrow_count"] or 0),
        "current_position": position,
        "activity_rows": rows,
        "backend": "etherscan_v2_event_logs",
    }


def fetch_morpho_spoke_features(wallet_address: str) -> list[dict]:
    """
    Morpho Blue activity on Base Sepolia only.

    Arbitrum Sepolia has no Morpho deployment — use morpho_spoke_chains() so it is never queried.
    """
    if _use_mock_data():
        return []

    if not _etherscan_api_key():
        logger.warning("Morpho: BASESCAN_API_KEY or ETHERSCAN_API_KEY not set — skipping Morpho indexing")
        return []

    per_chain = []

    for chain in morpho_spoke_chains():
        w3 = _web3_for_chain(chain)
        if not w3:
            logger.warning("Morpho %s: no RPC connection", chain.key)
            continue

        if not _morpho_deployed(w3):
            logger.warning("Morpho %s: Morpho Blue not deployed on chain %s", chain.key, chain.chain_id)
            continue

        try:
            morpho = w3.eth.contract(
                address=Web3.to_checksum_address(MORPHO_BLUE),
                abi=MORPHO_ABI,
            )
            rows = _fetch_morpho_events(w3, wallet_address, chain.key)

            market_ids = list(
                dict.fromkeys(r.get("market_id") for r in rows if r.get("market_id"))
            )
            position = _current_morpho_positions(morpho, wallet_address, market_ids)

            if not rows and not position.get("has_active_position"):
                logger.info("Morpho %s: no morpho events and no active position", chain.key)
                continue

            per_chain.append(_activity_to_borrow_features(rows, position, MORPHO_BLUE, chain.key))
            logger.info(
                "Morpho %s: supply=%s borrow=%s repay=%s rows=%s",
                chain.key,
                sum(1 for r in rows if r.get("action") == "Supply"),
                sum(1 for r in rows if r.get("action") == "Borrow"),
                sum(1 for r in rows if r.get("action") == "Repay"),
                len(rows),
            )
        except Exception as exc:
            logger.warning("Morpho fetch failed on %s for %s: %s", chain.key, wallet_address, exc)

    return per_chain
