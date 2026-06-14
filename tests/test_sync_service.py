"""Tests for cross-chain loan-active detection in sync_service."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from agents.sync_service import wallet_active_loan_sources


def _mock_agent(hub_loan_id: int = 0) -> MagicMock:
    agent = MagicMock()
    agent.lending.functions.activeLoanId.return_value.call.return_value = hub_loan_id
    return agent


@patch("agents.sync_service._spoke_active_loan_id", return_value=0)
def test_wallet_active_loan_sources_hub_only(mock_spoke):
    sources = wallet_active_loan_sources("0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844", _mock_agent(3))
    assert sources == ["hub"]
    mock_spoke.assert_called()


@patch("agents.sync_service._spoke_active_loan_id")
def test_wallet_active_loan_sources_spoke_only(mock_spoke):
    mock_spoke.side_effect = lambda chain, _wallet: 5 if chain == "arbitrum" else 0
    sources = wallet_active_loan_sources("0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844", _mock_agent(0))
    assert sources == ["arbitrum"]


@patch("agents.sync_service._spoke_active_loan_id")
def test_wallet_active_loan_sources_none(mock_spoke):
    mock_spoke.return_value = 0
    sources = wallet_active_loan_sources("0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844", _mock_agent(0))
    assert sources == []
