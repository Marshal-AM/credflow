"""Tests for Sybil detector."""

from ml.sybil_detector import build_transaction_graph, run_sybil_check


def test_organic_wallet_low_risk():
    wallet = "0x" + "a" * 40
    alchemy = {
        "recent_transactions": [
            {"from": wallet, "to": "0x" + "b" * 40},
            {"from": "0x" + "c" * 40, "to": wallet},
        ]
    }
    result = run_sybil_check(wallet, alchemy)
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


def test_build_transaction_graph_structure():
    graph = build_transaction_graph(
        "0x" + "1" * 40,
        {"recent_transactions": [{"from": "0x" + "1" * 40, "to": "0x" + "2" * 40}]},
    )
    assert graph["x"].shape[0] >= 1
    assert graph["edge_index"].shape[0] == 2
