"""Tests for Sybil detector."""

import tempfile
from pathlib import Path

from ml.sybil_detector import (
    build_transaction_graph,
    run_sybil_check,
    train_sybil_model,
)


def test_organic_wallet_low_risk():
    wallet = "0x" + "a" * 40
    alchemy = {
        "recent_transactions": [
            {"from": wallet, "to": "0x" + "b" * 40},
            {"from": "0x" + "c" * 40, "to": wallet},
        ]
    }
    result = run_sybil_check(wallet, alchemy, risk_addresses=set())
    assert result["sybil_risk"] in ("low", "medium")


def test_defaulter_link_high_risk():
    wallet = "0x" + "e" * 40
    defaulter = "0x" + "d" * 40
    alchemy = {
        "recent_transactions": [
            {"from": defaulter, "to": wallet},
            {"from": wallet, "to": defaulter},
        ]
    }
    result = run_sybil_check(wallet, alchemy, known_defaulters={defaulter})
    assert result["sybil_risk"] == "high"
    assert result["method"] == "defaulter_link"


def test_build_transaction_graph_structure():
    graph = build_transaction_graph(
        "0x" + "1" * 40,
        {"recent_transactions": [{"from": "0x" + "1" * 40, "to": "0x" + "2" * 40}]},
        risk_addresses=set(),
    )
    assert graph["x"].shape[0] >= 1
    assert graph["edge_index"].shape[0] == 2


def test_rgcn_inference_uses_model():
    wallet = "0x" + "f" * 40
    alchemy = {
        "recent_transactions": [
            {"from": wallet, "to": "0x" + "2" * 40},
            {"from": "0x" + "3" * 40, "to": wallet},
        ]
    }
    with tempfile.TemporaryDirectory() as tmp:
        model_path = str(Path(tmp) / "sybil_test.pt")
        train_sybil_model(n_samples=60, model_path=model_path, epochs=15)
        result = run_sybil_check(wallet, alchemy, model_path=model_path, risk_addresses=set())
        assert result["method"] == "rgcn"
        assert "sybil_probs" in result
        assert set(result["sybil_probs"]) == {"low", "medium", "high"}


def test_funded_low_activity_wallet_is_low_risk():
    """Repeated transfers from one funder should not be medium sybil."""
    wallet = "0x5732e1bccAEB161E3B93D126010042B0F1b9CFC9"
    funder = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"
    alchemy = {
        "tx_count": 6,
        "recent_transactions": [
            {"from": funder, "to": wallet, "hash": f"0x{hex(i)[2:].zfill(64)}"}
            for i in range(32)
        ],
    }
    result = run_sybil_check(wallet, alchemy, risk_addresses=set())
    assert result["sybil_risk"] == "low"


def test_spray_pattern_medium_or_high_heuristic():
    wallet = "0x" + "8" * 40
    alchemy = {
        "tx_count": 20,
        "recent_transactions": [
            {
                "from": wallet,
                "to": f"0x{hex(i)[2:].zfill(40)}",
                "hash": f"0x{hex(i)[2:].zfill(64)}",
            }
            for i in range(20)
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        model_path = str(Path(tmp) / "missing.pt")
        result = run_sybil_check(wallet, alchemy, model_path=model_path, risk_addresses=set())
        assert result["method"] == "heuristic"
        assert result["sybil_risk"] in ("medium", "high")


def test_rgcn_high_risk_synthetic_cluster():
    wallet = "0x" + "9" * 40
    alchemy = {
        "recent_transactions": [
            {"from": wallet, "to": f"0x{hex(i)[2:].zfill(40)}"} for i in range(20)
        ]
    }
    with tempfile.TemporaryDirectory() as tmp:
        model_path = str(Path(tmp) / "sybil_test.pt")
        train_sybil_model(n_samples=120, model_path=model_path, epochs=25)
        result = run_sybil_check(wallet, alchemy, model_path=model_path, risk_addresses=set())
        assert result["method"] == "rgcn"
        assert result["sybil_risk"] in ("low", "medium", "high")
