"""Post-default linked wallet discovery via transaction graph traversal."""

from __future__ import annotations

import logging
import os
import time
from collections import deque

import networkx as nx
import requests
from dotenv import load_dotenv
from web3 import Web3

from indexer.chains import active_rpc_chains, chain_alchemy_rpc_url, load_hub_addresses

load_dotenv()

logger = logging.getLogger(__name__)

LENDING_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "activeLoanId",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "name": "loans",
        "outputs": [
            {"internalType": "address", "name": "borrower", "type": "address"},
            {"internalType": "address", "name": "collateralToken", "type": "address"},
            {"internalType": "uint256", "name": "collateralAmount", "type": "uint256"},
            {"internalType": "uint256", "name": "borrowedAmount", "type": "uint256"},
            {"internalType": "uint256", "name": "interestRate", "type": "uint256"},
            {"internalType": "uint256", "name": "startTime", "type": "uint256"},
            {"internalType": "uint256", "name": "dueTime", "type": "uint256"},
            {"internalType": "uint256", "name": "maxLTV", "type": "uint256"},
            {"internalType": "bool", "name": "active", "type": "bool"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
]


def configure_graph_logging(level: str | None = None) -> None:
    """Send graph_analysis logs to stderr (for CLI smoke scripts)."""
    log_level = (level or os.environ.get("GRAPH_ANALYSIS_LOG_LEVEL", "INFO")).upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s | %(levelname)-7s | graph_analysis | %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )


def _alchemy_url_labels() -> dict[str, str]:
    labels: dict[str, str] = {}
    for chain in active_rpc_chains():
        url = chain_alchemy_rpc_url(chain)
        if url:
            labels[url] = chain.key
    return labels


def _alchemy_urls() -> list[str]:
    return list(_alchemy_url_labels().keys())


def _short_addr(address: str) -> str:
    if len(address) < 12:
        return address
    return f"{address[:6]}...{address[-4:]}"


def _fetch_transfers(
    alchemy_url: str,
    params: dict,
    *,
    chain_label: str = "unknown",
) -> list[dict]:
    direction = "outbound" if params.get("fromAddress") else "inbound"
    wallet = params.get("fromAddress") or params.get("toAddress") or "?"
    logger.info(
        "Alchemy request | chain=%s | %s | wallet=%s | maxCount=%s",
        chain_label,
        direction,
        _short_addr(wallet),
        params.get("maxCount", "?"),
    )
    t0 = time.perf_counter()
    try:
        response = requests.post(
            alchemy_url,
            json={
                "jsonrpc": "2.0",
                "method": "alchemy_getAssetTransfers",
                "params": [params],
                "id": 1,
            },
            timeout=30,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        body = response.json()
        if response.status_code != 200:
            logger.warning(
                "Alchemy HTTP %s | chain=%s | %s | wallet=%s | %.0fms | body=%s",
                response.status_code,
                chain_label,
                direction,
                _short_addr(wallet),
                elapsed_ms,
                body,
            )
            return []
        if body.get("error"):
            logger.warning(
                "Alchemy JSON-RPC error | chain=%s | %s | wallet=%s | %.0fms | error=%s",
                chain_label,
                direction,
                _short_addr(wallet),
                elapsed_ms,
                body["error"],
            )
            return []
        transfers = body.get("result", {}).get("transfers", [])
        logger.info(
            "Alchemy response | chain=%s | %s | wallet=%s | transfers=%s | %.0fms",
            chain_label,
            direction,
            _short_addr(wallet),
            len(transfers),
            elapsed_ms,
        )
        return transfers
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.warning(
            "Alchemy fetch failed | chain=%s | %s | wallet=%s | %.0fms | %s",
            chain_label,
            direction,
            _short_addr(wallet),
            elapsed_ms,
            exc,
        )
        return []


def _transfer_value(transfer: dict) -> float:
    raw = transfer.get("value")
    if raw is None:
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def get_transaction_counterparties(
    wallet_address: str,
    depth: int = 2,
    max_wallets: int | None = None,
) -> nx.DiGraph:
    """
    Fetch wallets that have transacted with the given wallet up to a specified depth.
    Depth 1 = direct counterparties only (still fetches their transfer lists).
    Depth 2 = counterparties of counterparties (many more Alchemy calls).

    max_wallets caps how many addresses are visited — use for smoke tests / rate limits.
    """
    wallet_address = Web3.to_checksum_address(wallet_address)
    url_labels = _alchemy_url_labels()
    if not url_labels:
        logger.warning("No Alchemy RPC URLs configured — returning empty graph")
        return nx.DiGraph()

    cap = max_wallets
    if cap is None:
        env_cap = os.environ.get("GRAPH_ANALYSIS_MAX_WALLETS", "").strip()
        cap = int(env_cap) if env_cap.isdigit() else None

    logger.info(
        "BFS start | root=%s | depth=%s | max_wallets=%s | chains=%s",
        _short_addr(wallet_address),
        depth,
        cap if cap is not None else "unlimited",
        list(url_labels.values()),
    )

    visited: set[str] = set()
    graph = nx.DiGraph()
    queue: deque[tuple[str, int]] = deque([(wallet_address, 0)])
    api_calls = 0
    skipped_cap = 0
    t0 = time.perf_counter()

    while queue:
        if cap is not None and len(visited) >= cap:
            skipped_cap = len(queue)
            logger.info(
                "BFS cap reached | max_wallets=%s | stopping | remaining_queue=%s",
                cap,
                skipped_cap,
            )
            break

        current_wallet, current_depth = queue.popleft()
        if current_wallet in visited or current_depth > depth:
            continue
        visited.add(current_wallet)
        logger.info(
            "BFS visit | wallet=%s | depth=%s/%s | visited=%s | queue=%s",
            _short_addr(current_wallet),
            current_depth,
            depth,
            len(visited),
            len(queue),
        )

        for alchemy_url, chain_label in url_labels.items():
            outbound = _fetch_transfers(
                alchemy_url,
                {
                    "fromAddress": current_wallet,
                    "maxCount": "0x64",
                    "category": ["external", "erc20"],
                },
                chain_label=chain_label,
            )
            api_calls += 1
            for tx in outbound:
                to_address = tx.get("to")
                value = _transfer_value(tx)
                if to_address and to_address.lower() != current_wallet.lower():
                    to_checksum = Web3.to_checksum_address(to_address)
                    existing = graph.get_edge_data(current_wallet, to_checksum, {})
                    graph.add_edge(
                        current_wallet,
                        to_checksum,
                        weight=existing.get("weight", 0) + value,
                    )
                    if current_depth + 1 <= depth:
                        queue.append((to_checksum, current_depth + 1))

            incoming = _fetch_transfers(
                alchemy_url,
                {
                    "toAddress": current_wallet,
                    "maxCount": "0x64",
                    "category": ["external", "erc20"],
                },
                chain_label=chain_label,
            )
            api_calls += 1
            for tx in incoming:
                from_address = tx.get("from")
                value = _transfer_value(tx)
                if from_address and from_address.lower() != current_wallet.lower():
                    from_checksum = Web3.to_checksum_address(from_address)
                    existing = graph.get_edge_data(from_checksum, current_wallet, {})
                    graph.add_edge(
                        from_checksum,
                        current_wallet,
                        weight=existing.get("weight", 0) + value,
                    )
                    if current_depth + 1 <= depth:
                        queue.append((from_checksum, current_depth + 1))

    elapsed = time.perf_counter() - t0
    logger.info(
        "BFS done | nodes=%s | edges=%s | api_calls=%s | skipped_by_cap=%s | %.1fs",
        graph.number_of_nodes(),
        graph.number_of_edges(),
        api_calls,
        skipped_cap,
        elapsed,
    )
    return graph


def identify_linked_wallets(
    defaulter_address: str,
    graph: nx.DiGraph,
    min_transaction_value: float = 0.01,
) -> list[dict]:
    """Identify wallets suspiciously linked to the defaulter via graph heuristics."""
    defaulter_address = Web3.to_checksum_address(defaulter_address)
    linked: list[dict] = []

    direct_neighbors = list(graph.neighbors(defaulter_address))
    for neighbor in direct_neighbors:
        edge_data = graph.get_edge_data(defaulter_address, neighbor, {})
        value = edge_data.get("weight", 0)
        if value >= min_transaction_value:
            linked.append(
                {
                    "wallet": neighbor,
                    "reason": "direct_transfer",
                    "value": value,
                    "confidence": "high" if value > 0.1 else "medium",
                }
            )

    predecessors = list(graph.predecessors(defaulter_address))
    for pred in predecessors:
        edge_data = graph.get_edge_data(pred, defaulter_address, {})
        value = edge_data.get("weight", 0)
        if value >= min_transaction_value:
            linked.append(
                {
                    "wallet": pred,
                    "reason": "funded_defaulter",
                    "value": value,
                    "confidence": "medium",
                }
            )

    subgraph_nodes = set([defaulter_address] + direct_neighbors + predecessors)
    subgraph = graph.subgraph(subgraph_nodes)
    for component in nx.strongly_connected_components(subgraph):
        if defaulter_address in component and len(component) > 1:
            for wallet in component:
                if wallet != defaulter_address:
                    linked.append(
                        {
                            "wallet": wallet,
                            "reason": "cluster_member",
                            "value": 0,
                            "confidence": "high",
                        }
                    )

    seen: set[str] = set()
    unique_linked: list[dict] = []
    for item in linked:
        wallet = item["wallet"]
        if wallet not in seen:
            seen.add(wallet)
            unique_linked.append(item)

    return unique_linked


def cap_linked_wallets(linked: list[dict], max_wallets: int) -> list[dict]:
    """Keep the strongest linked-wallet candidates up to max_wallets."""
    if max_wallets <= 0 or len(linked) <= max_wallets:
        return linked

    confidence_rank = {"high": 0, "medium": 1, "low": 2}

    def sort_key(item: dict) -> tuple[int, float, str]:
        conf = confidence_rank.get(str(item.get("confidence", "")).lower(), 3)
        try:
            value = float(item.get("value") or 0)
        except (TypeError, ValueError):
            value = 0.0
        return (conf, -value, str(item.get("wallet", "")).lower())

    capped = sorted(linked, key=sort_key)[:max_wallets]
    logger.info(
        "Linked wallets capped | before=%s after=%s max=%s",
        len(linked),
        len(capped),
        max_wallets,
    )
    return capped


def get_lending_contract():
    """Return a web3 lending contract instance for the hub deployment."""
    lending_address = os.environ.get("CREDFLOW_LENDING_ADDRESS", "").strip()
    if not lending_address:
        addresses = load_hub_addresses()
        lending_address = addresses.get("lending", "")

    if not lending_address:
        raise ValueError("CREDFLOW_LENDING_ADDRESS not set and docs/addresses.json has no lending address")

    rpc_url = os.environ.get("RPC_ROBINHOOD", "").strip()
    if not rpc_url:
        raise ValueError("RPC_ROBINHOOD not set")

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise ConnectionError(f"Could not connect to Robinhood RPC: {rpc_url}")

    return w3.eth.contract(
        address=Web3.to_checksum_address(lending_address),
        abi=LENDING_ABI,
    )


def check_existing_credflow_loans(linked_wallets: list, lending_contract=None) -> list[dict]:
    """Check if any linked wallets currently have active CredFlow loans."""
    contract = lending_contract or get_lending_contract()
    at_risk: list[dict] = []

    for wallet_info in linked_wallets:
        wallet = wallet_info["wallet"]
        try:
            checksum = Web3.to_checksum_address(wallet)
            loan_id = contract.functions.activeLoanId(checksum).call()
            if loan_id > 0:
                loan = contract.functions.loans(loan_id).call()
                if loan[8]:
                    at_risk.append(
                        {
                            **wallet_info,
                            "active_loan_id": loan_id,
                            "borrowed_amount": loan[3],
                        }
                    )
        except Exception as exc:
            logger.debug("Loan check failed for %s: %s", wallet, exc)

    return at_risk
