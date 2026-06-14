"""Serializable wallet neighborhood graph for CredScore / Sybil UI."""

from __future__ import annotations

from typing import Any, Iterator

from ml.sybil_detector import resolve_sybil_risk_addresses

MAX_GRAPH_NODES = 20


def _short_addr(addr: str) -> str:
    if len(addr) < 12:
        return addr
    return f"{addr[:6]}…{addr[-4:]}"


def _role_for(addr: str, wallet: str, defaulters: set[str]) -> str:
    if addr == wallet:
        return "self"
    if addr in defaulters:
        return "defaulter"
    return "counterparty"


def stream_wallet_graph(
    wallet_address: str,
    alchemy_state: dict,
    risk_addresses: set[str] | None = None,
    known_defaulters: set[str] | None = None,
    *,
    max_nodes: int = MAX_GRAPH_NODES,
) -> Iterator[dict[str, Any]]:
    """
    Yield graph_node / graph_edge events while parsing Alchemy transfers.
    Caps visible nodes; always includes the hub wallet.
    """
    defaulters = resolve_sybil_risk_addresses(
        wallet_address, alchemy_state, risk_addresses, known_defaulters=known_defaulters
    )
    wallet = wallet_address.lower()
    transfers = alchemy_state.get("recent_transactions", []) or []
    lifetime_tx_count = int(alchemy_state.get("tx_count", 0) or 0)

    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    seen_tx_keys: set[tuple[str, str, str]] = set()
    counterparty_counts: dict[str, int] = {}
    defaulter_links = 0

    def ensure_node(addr: str) -> dict[str, Any] | None:
        if addr in nodes:
            return nodes[addr]
        if len(nodes) >= max_nodes and addr != wallet:
            return None
        node = {
            "id": addr,
            "label": _short_addr(addr),
            "role": _role_for(addr, wallet, defaulters),
            "tx_count": 0,
        }
        nodes[addr] = node
        yield_event = {"type": "graph_node", "node": node}
        return node, yield_event

    # Hub first
    hub = {
        "id": wallet,
        "label": _short_addr(wallet_address),
        "role": "self",
        "tx_count": 0,
    }
    nodes[wallet] = hub
    yield {"type": "graph_node", "node": hub}

    for tx in transfers:
        frm = (tx.get("from") or "").lower()
        to = (tx.get("to") or "").lower()
        if not frm or not to or frm == to:
            continue

        tx_key = (
            tx.get("hash") or tx.get("uniqueId") or f"{frm}:{to}:{tx.get('blockNum', '')}",
            frm,
            to,
        )
        if tx_key in seen_tx_keys:
            continue
        seen_tx_keys.add(tx_key)

        for addr in (frm, to):
            if addr not in nodes:
                if len(nodes) >= max_nodes and addr != wallet:
                    continue
                node = {
                    "id": addr,
                    "label": _short_addr(addr),
                    "role": _role_for(addr, wallet, defaulters),
                    "tx_count": 0,
                }
                nodes[addr] = node
                yield {"type": "graph_node", "node": node}
            nodes[addr]["tx_count"] = int(nodes[addr].get("tx_count", 0)) + 1

        if frm in nodes and to in nodes:
            direction = "out" if frm == wallet else "in" if to == wallet else "peer"
            edge = {
                "id": f"{frm}->{to}:{len(edges)}",
                "from": frm,
                "to": to,
                "direction": direction,
            }
            edges.append(edge)
            yield {"type": "graph_edge", "edge": edge}

        counterparty = to if frm == wallet else frm if to == wallet else None
        if counterparty and counterparty != wallet:
            counterparty_counts[counterparty] = counterparty_counts.get(counterparty, 0) + 1
            if counterparty in defaulters:
                defaulter_links += 1

    unique_counterparties = len(counterparty_counts)
    hub_score = max(counterparty_counts.values()) if counterparty_counts else 0
    spray_score = (
        unique_counterparties if unique_counterparties > 0 and hub_score <= 2 else 0
    )

    yield {
        "type": "graph_meta",
        "meta": {
            "num_nodes": len(nodes),
            "num_edges": len(edges),
            "unique_counterparties": unique_counterparties,
            "unique_tx_count": len(seen_tx_keys),
            "lifetime_tx_count": lifetime_tx_count,
            "defaulter_links": defaulter_links,
            "hub_score": hub_score,
            "spray_score": spray_score,
            "capped": len(nodes) >= max_nodes,
        },
    }


def collect_wallet_graph(
    wallet_address: str,
    alchemy_state: dict,
    risk_addresses: set[str] | None = None,
    known_defaulters: set[str] | None = None,
) -> dict[str, Any]:
    """Collect full serializable graph payload (nodes, edges, meta)."""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}
    for event in stream_wallet_graph(
        wallet_address, alchemy_state, risk_addresses, known_defaulters=known_defaulters
    ):
        if event["type"] == "graph_node":
            nodes.append(event["node"])
        elif event["type"] == "graph_edge":
            edges.append(event["edge"])
        elif event["type"] == "graph_meta":
            meta = event["meta"]
    return {"nodes": nodes, "edges": edges, "meta": meta}
