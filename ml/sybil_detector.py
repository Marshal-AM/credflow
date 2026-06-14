"""R-GCN Sybil detector — transaction graph analysis at underwriting time."""

import logging
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F

from ml.constants import SYBIL_MODEL_PATH
from ml.on_chain_blacklist import fetch_on_chain_risk_addresses

logger = logging.getLogger(__name__)


def extract_graph_addresses(wallet_address: str, alchemy_state: dict) -> set[str]:
    """All wallet addresses appearing in the sybil transfer graph."""
    wallet = wallet_address.lower()
    addresses = {wallet}
    for tx in alchemy_state.get("recent_transactions", []) or []:
        frm = (tx.get("from") or "").lower()
        to = (tx.get("to") or "").lower()
        if frm:
            addresses.add(frm)
        if to:
            addresses.add(to)
    return addresses


def resolve_sybil_risk_addresses(
    wallet_address: str,
    alchemy_state: dict,
    risk_addresses: set[str] | None = None,
    *,
    known_defaulters: set[str] | None = None,
) -> set[str]:
    """On-chain hub/spoke blacklist + defaulters; tests may inject risk_addresses."""
    override = risk_addresses if risk_addresses is not None else known_defaulters
    if override is not None:
        return {a.strip().lower() for a in override if a.strip()}
    return fetch_on_chain_risk_addresses(extract_graph_addresses(wallet_address, alchemy_state))


def build_transaction_graph(
    wallet_address: str,
    alchemy_state: dict,
    risk_addresses: set[str] | None = None,
    known_defaulters: set[str] | None = None,
) -> dict:
    """
    Build a wallet interaction graph from Alchemy transfer history.
    Returns node features, edge index, and metadata for inference/heuristics.
    """
    defaulters = resolve_sybil_risk_addresses(
        wallet_address, alchemy_state, risk_addresses, known_defaulters=known_defaulters
    )
    wallet = wallet_address.lower()
    transfers = alchemy_state.get("recent_transactions", []) or []
    lifetime_tx_count = int(alchemy_state.get("tx_count", 0) or 0)

    nodes = {wallet: 0}
    edges: list[tuple[int, int]] = []
    counterparty_counts: dict[str, int] = {}
    defaulter_links = 0
    seen_tx_keys: set[tuple[str, str, str]] = set()
    node_tx_counts: dict[str, int] = {wallet: 0}

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
                nodes[addr] = len(nodes)
            node_tx_counts[addr] = node_tx_counts.get(addr, 0) + 1

        edges.append((nodes[frm], nodes[to]))

        counterparty = to if frm == wallet else frm if to == wallet else None
        if counterparty and counterparty != wallet:
            counterparty_counts[counterparty] = counterparty_counts.get(counterparty, 0) + 1
            if counterparty in defaulters:
                defaulter_links += 1

    unique_counterparties = len(counterparty_counts)
    unique_tx_count = len(seen_tx_keys)
    hub_score = max(counterparty_counts.values()) if counterparty_counts else 0
    spray_score = (
        unique_counterparties
        if unique_counterparties > 0 and hub_score <= 2
        else 0
    )

    if not edges:
        x = torch.tensor([[1.0, 0.0, 0.0, 0.0]], dtype=torch.float)
        edge_index = torch.zeros((2, 0), dtype=torch.long)
    else:
        node_features = []
        for addr, _idx in sorted(nodes.items(), key=lambda kv: kv[1]):
            is_target = 1.0 if addr == wallet else 0.0
            is_defaulter = 1.0 if addr in defaulters else 0.0
            tx_degree = float(node_tx_counts.get(addr, 0))
            node_features.append(
                [
                    is_target,
                    is_defaulter,
                    tx_degree / 20.0,
                    float(unique_counterparties) / 30.0,
                ]
            )
        x = torch.tensor(node_features, dtype=torch.float)
        edge_index = torch.tensor(edges, dtype=torch.long).t().contiguous()

    return {
        "x": x,
        "edge_index": edge_index,
        "num_nodes": x.shape[0],
        "unique_counterparties": unique_counterparties,
        "unique_tx_count": unique_tx_count,
        "lifetime_tx_count": lifetime_tx_count,
        "defaulter_links": defaulter_links,
        "hub_score": hub_score,
        "spray_score": spray_score,
        "wallet_index": nodes.get(wallet, 0),
    }


class RGCNSybilDetector(nn.Module):
    """Relational GCN for Sybil risk classification."""

    def __init__(self, in_channels: int = 4, hidden: int = 16, num_relations: int = 1):
        super().__init__()
        try:
            from torch_geometric.nn import RGCNConv
        except ImportError as exc:
            raise ImportError("torch-geometric required for RGCNSybilDetector") from exc

        self.conv1 = RGCNConv(in_channels, hidden, num_relations)
        self.conv2 = RGCNConv(hidden, hidden, num_relations)
        self.fc = nn.Linear(hidden, 3)

    def forward(self, x, edge_index, edge_type=None):
        if edge_type is None:
            edge_type = torch.zeros(edge_index.size(1), dtype=torch.long, device=x.device)

        x = self.conv1(x, edge_index, edge_type)
        x = F.relu(x)
        x = F.dropout(x, p=0.2, training=self.training)
        x = self.conv2(x, edge_index, edge_type)
        x = F.relu(x)
        wallet_idx = 0
        return self.fc(x[wallet_idx])


def _is_organic_low_activity(graph: dict) -> bool:
    """Wallets with few counterparties and no defaulter links are not sybil."""
    if graph["defaulter_links"] > 0:
        return False
    if graph["num_nodes"] <= 1:
        return True
    lifetime = int(graph.get("lifetime_tx_count", 0) or 0)
    unique_cp = int(graph.get("unique_counterparties", 0) or 0)
    return unique_cp <= 5 and lifetime <= 200


def _heuristic_sybil_risk(graph: dict) -> dict:
    """Rule-based fallback when model artifact is unavailable."""
    if _is_organic_low_activity(graph):
        return {
            "sybil_risk": "low",
            "sybil_score": 0,
            "method": "heuristic",
            "defaulter_links": graph["defaulter_links"],
            "unique_counterparties": graph["unique_counterparties"],
            "reason": "organic_low_activity",
        }

    score = 0
    if graph["defaulter_links"] > 0:
        score += 3
    # Fan-out spray: many unique counterparties, few repeat interactions each
    if graph.get("spray_score", 0) >= 15:
        score += 2
    if graph["unique_counterparties"] >= 25 and graph.get("hub_score", 0) <= 3:
        score += 2
    if graph["unique_counterparties"] >= 40:
        score += 1

    if score >= 3:
        risk = "high"
    elif score >= 2:
        risk = "medium"
    else:
        risk = "low"

    return {
        "sybil_risk": risk,
        "sybil_score": score,
        "method": "heuristic",
        "defaulter_links": graph["defaulter_links"],
        "unique_counterparties": graph["unique_counterparties"],
    }


def _apply_organic_floor(result: dict, graph: dict) -> dict:
    """Prevent low-activity organic wallets from being flagged medium/high by R-GCN."""
    if not _is_organic_low_activity(graph):
        return result
    if result.get("sybil_risk") == "low":
        return result
    return {
        **result,
        "sybil_risk": "low",
        "sybil_score": 0,
        "method": f"{result.get('method', 'rgcn')}+organic_floor",
        "organic_floor_reason": (
            f"unique_counterparties={graph['unique_counterparties']}, "
            f"lifetime_tx_count={graph.get('lifetime_tx_count', 0)}"
        ),
    }


def run_sybil_check(
    wallet_address: str,
    alchemy_state: dict,
    model_path: str = SYBIL_MODEL_PATH,
    risk_addresses: set[str] | None = None,
    known_defaulters: set[str] | None = None,
) -> dict:
    """Run Sybil detection; returns risk level low/medium/high."""
    graph = build_transaction_graph(
        wallet_address,
        alchemy_state,
        risk_addresses=risk_addresses,
        known_defaulters=known_defaulters,
    )

    if graph["defaulter_links"] > 0:
        return {
            "sybil_risk": "high",
            "sybil_score": 3,
            "method": "defaulter_link",
            "defaulter_links": graph["defaulter_links"],
            "unique_counterparties": graph["unique_counterparties"],
        }

    if not Path(model_path).exists():
        return _heuristic_sybil_risk(graph)

    try:
        model = RGCNSybilDetector()
        model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
        model.eval()

        x = graph["x"]
        edge_index = graph["edge_index"]
        with torch.no_grad():
            logits = model(x, edge_index)
            probs = F.softmax(logits, dim=0).tolist()

        risk_idx = int(torch.argmax(torch.tensor(probs)).item())
        risk_map = {0: "low", 1: "medium", 2: "high"}

        result = {
            "sybil_risk": risk_map[risk_idx],
            "sybil_probs": {"low": probs[0], "medium": probs[1], "high": probs[2]},
            "method": "rgcn",
            "defaulter_links": graph["defaulter_links"],
            "unique_counterparties": graph["unique_counterparties"],
        }
        return _apply_organic_floor(result, graph)
    except Exception as exc:
        logger.warning("R-GCN inference failed, using heuristic: %s", exc)
        return _heuristic_sybil_risk(graph)


def generate_synthetic_graphs(n_samples: int = 200, seed: int = 42) -> list[dict]:
    """Generate labeled synthetic graphs for sybil model training."""
    import random

    rng = random.Random(seed)
    samples = []

    for i in range(n_samples):
        label = rng.choices([0, 1, 2], weights=[0.7, 0.2, 0.1])[0]
        if label == 0:
            wallet = f"0x{hex(i)[2:].zfill(40)}"
            funder = f"0x{'a'*40}"
            alchemy = {
                "recent_transactions": [
                    {
                        "from": funder,
                        "to": wallet,
                        "hash": f"0x{hex(i + j)[2:].zfill(64)}",
                    }
                    for j in range(8)
                ],
                "tx_count": 8,
            }
        elif label == 1:
            wallet = f"0x{hex(i)[2:].zfill(40)}"
            alchemy = {
                "recent_transactions": [
                    {
                        "from": wallet,
                        "to": f"0x{hex(i + j + 1)[2:].zfill(40)}",
                        "hash": f"0x{hex(i + j + 1)[2:].zfill(64)}",
                    }
                    for j in range(18)
                ],
                "tx_count": 18,
            }
        else:
            wallet = f"0x{hex(i)[2:].zfill(40)}"
            defaulter = "0x" + "d" * 40
            alchemy = {
                "recent_transactions": [
                    {"from": defaulter, "to": wallet, "hash": f"0xdefin{i:064x}"},
                    {"from": wallet, "to": defaulter, "hash": f"0xdefout{i:064x}"},
                ],
                "tx_count": 2,
            }

        if label == 2:
            graph = build_transaction_graph(wallet, alchemy, risk_addresses={defaulter})
        else:
            graph = build_transaction_graph(wallet, alchemy, risk_addresses=set())
        graph["label"] = label
        samples.append(graph)

    return samples


def train_sybil_model(
    n_samples: int = 200,
    model_path: str = SYBIL_MODEL_PATH,
    epochs: int = 30,
) -> str:
    """Train R-GCN on synthetic graph data."""
    samples = generate_synthetic_graphs(n_samples)
    split = int(len(samples) * 0.8)
    train_samples = samples[:split]
    val_samples = samples[split:]

    model = RGCNSybilDetector()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    criterion = nn.CrossEntropyLoss()

    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        for sample in train_samples:
            optimizer.zero_grad()
            logits = model(sample["x"], sample["edge_index"])
            target = torch.tensor(sample["label"], dtype=torch.long)
            loss = criterion(logits.unsqueeze(0), target.unsqueeze(0))
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        if (epoch + 1) % 10 == 0:
            print(f"Sybil epoch {epoch + 1}/{epochs} loss={total_loss / len(train_samples):.4f}")

    model.eval()
    correct = 0
    with torch.no_grad():
        for sample in val_samples:
            logits = model(sample["x"], sample["edge_index"])
            pred = int(torch.argmax(logits).item())
            if pred == sample["label"]:
                correct += 1
    val_acc = correct / len(val_samples) if val_samples else 0.0
    print(f"Sybil validation accuracy: {val_acc:.2%} ({correct}/{len(val_samples)})")

    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), model_path)
    print(f"Saved sybil model -> {model_path}")
    return model_path
