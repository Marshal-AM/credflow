"""Tests for post-default graph analysis."""

from unittest.mock import MagicMock, patch

import networkx as nx

from ml.graph_analysis import (
    cap_linked_wallets,
    check_existing_credflow_loans,
    get_transaction_counterparties,
    identify_linked_wallets,
)


def _mock_alchemy_side_effect(*args, **kwargs):
    payload = kwargs.get("json", {})
    params = payload.get("params", [{}])[0]
    if params.get("fromAddress"):
        return MagicMock(
            status_code=200,
            json=lambda: {
                "result": {
                    "transfers": [
                        {
                            "from": params["fromAddress"],
                            "to": "0x2222222222222222222222222222222222222222",
                            "value": 0.5,
                        }
                    ]
                }
            },
        )
    if params.get("toAddress"):
        return MagicMock(
            status_code=200,
            json=lambda: {
                "result": {
                    "transfers": [
                        {
                            "from": "0x1111111111111111111111111111111111111111",
                            "to": params["toAddress"],
                            "value": 0.2,
                        }
                    ]
                }
            },
        )
    return MagicMock(status_code=200, json=lambda: {"result": {"transfers": []}})


@patch("ml.graph_analysis._alchemy_urls", return_value=["https://alchemy.test/v2/key"])
@patch("ml.graph_analysis.requests.post", side_effect=_mock_alchemy_side_effect)
def test_get_transaction_counterparties_builds_graph(mock_post, mock_urls):
    defaulter = "0x3333333333333333333333333333333333333333"
    graph = get_transaction_counterparties(defaulter, depth=1)

    assert graph.number_of_nodes() >= 2
    assert mock_post.called


def test_identify_linked_wallets_direct_transfer():
    defaulter = "0x3333333333333333333333333333333333333333"
    neighbor = "0x2222222222222222222222222222222222222222"
    graph = nx.DiGraph()
    graph.add_edge(defaulter, neighbor, weight=0.5)

    linked = identify_linked_wallets(defaulter, graph, min_transaction_value=0.01)
    reasons = {item["wallet"]: item["reason"] for item in linked}

    assert neighbor in reasons
    assert reasons[neighbor] == "direct_transfer"


def test_identify_linked_wallets_funded_defaulter():
    defaulter = "0x3333333333333333333333333333333333333333"
    funder = "0x1111111111111111111111111111111111111111"
    graph = nx.DiGraph()
    graph.add_edge(funder, defaulter, weight=0.25)

    linked = identify_linked_wallets(defaulter, graph, min_transaction_value=0.01)
    reasons = {item["wallet"]: item["reason"] for item in linked}

    assert funder in reasons
    assert reasons[funder] == "funded_defaulter"


def test_cap_linked_wallets_prefers_high_confidence():
    linked = [
        {"wallet": f"0x{'a' * 40}", "confidence": "low", "value": 99},
        {"wallet": f"0x{'b' * 40}", "confidence": "high", "value": 0.01},
        {"wallet": f"0x{'c' * 40}", "confidence": "medium", "value": 50},
    ]
    capped = cap_linked_wallets(linked, 2)
    assert len(capped) == 2
    assert capped[0]["confidence"] == "high"
    assert capped[1]["confidence"] == "medium"


def test_check_existing_credflow_loans_flags_active():
    mock_contract = MagicMock()
    wallet = "0x2222222222222222222222222222222222222222"
    mock_contract.functions.activeLoanId.return_value.call.return_value = 1
    mock_contract.functions.loans.return_value.call.return_value = (
        wallet,
        "0x0000000000000000000000000000000000000000",
        0,
        5000000,
        500,
        0,
        0,
        6000,
        True,
    )

    linked = [{"wallet": wallet, "reason": "direct_transfer", "value": 0.5, "confidence": "high"}]
    at_risk = check_existing_credflow_loans(linked, lending_contract=mock_contract)

    assert len(at_risk) == 1
    assert at_risk[0]["active_loan_id"] == 1
    assert at_risk[0]["borrowed_amount"] == 5000000


def test_check_existing_credflow_loans_skips_inactive():
    mock_contract = MagicMock()
    wallet = "0x2222222222222222222222222222222222222222"
    mock_contract.functions.activeLoanId.return_value.call.return_value = 1
    mock_contract.functions.loans.return_value.call.return_value = (
        wallet,
        "0x0000000000000000000000000000000000000000",
        0,
        5000000,
        500,
        0,
        0,
        6000,
        False,
    )

    linked = [{"wallet": wallet, "reason": "direct_transfer", "value": 0.5, "confidence": "high"}]
    at_risk = check_existing_credflow_loans(linked, lending_contract=mock_contract)

    assert at_risk == []
