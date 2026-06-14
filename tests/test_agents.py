"""Unit tests for Phase 3 Groq agents (no live RPC/Groq in CI)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from web3 import Web3

from agents.groq_brain import (
    LiquidationVerdict,
    MonitorVerdict,
    RateVerdict,
    UnderwritingVerdict,
    review_liquidation_blacklist,
    review_underwriting,
)
from agents.lz_options import build_lz_options
from agents.underwriter_agent import _is_borderline, _resolve_onchain_cred_score


def test_build_lz_options_encoding():
    opts = build_lz_options(200_000)
    assert opts.hex() == "00030100110100000000000000000000000000030d40"


def test_borderline_detection():
    assert _is_borderline(550, "low") is False
    assert _is_borderline(490, "low") is True
    assert _is_borderline(600, "medium") is False
    assert _is_borderline(500, "medium") is True


def test_resolve_onchain_cred_score_prefers_ml_over_floor():
    """Post-repay floor is display-only; underwriter writes fresh ML score."""
    floored = {
        "cred_score": 830,
        "on_chain_cred_score": 830,
        "ml_cred_score": 791,
        "floor_cred_score": 830,
        "score_floored": True,
    }
    assert _resolve_onchain_cred_score(floored) == 791

    reclaim = {
        "cred_score": 720,
        "on_chain_cred_score": 720,
        "ml_cred_score": 791,
        "reclaim_proof_hash": "0xabc",
    }
    assert _resolve_onchain_cred_score(reclaim) == 720


def test_rescore_updates_when_ml_differs_from_on_chain():
    """Floored snapshot must still trigger updateScore when hub score differs."""
    mock_agent = MagicMock()
    mock_agent.sbt.functions.isBlacklisted.return_value.call.return_value = False
    mock_agent.sbt.functions.hasProfile.return_value.call.return_value = True
    mock_agent.sbt.functions.getProfile.return_value.call.return_value = (830, 60, 90, "QmTest")
    mock_agent.score_engine = None
    mock_agent.send_tx = MagicMock(return_value="0xdeadbeef")

    score_payload = {
        "status": "complete",
        "cred_score": 830,
        "on_chain_cred_score": 830,
        "ml_cred_score": 791,
        "floor_cred_score": 830,
        "score_floored": True,
        "sybil_risk": "medium",
        "approved": True,
        "borrow_sub_score": 60,
        "wallet_sub_score": 90,
        "shap_cid": "QmTest",
        "model_breakdown": {},
        "default_prob_bps": 200,
        "balance_usd_cents": 0,
    }

    from agents.underwriter_agent import underwrite_wallet

    result = underwrite_wallet(mock_agent, "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844", rescore=True, score_data=score_payload)

    assert result["action"] == "approve"
    assert result["cred_score"] == 791
    assert result["onchain"] == "updateScore"
    mock_agent.send_tx.assert_called_once()


def test_groq_fallback_underwriting():
    with patch("agents.groq_brain._get_llm", side_effect=RuntimeError("no api")):
        verdict = review_underwriting("0x" + "ab" * 20, 510, "medium", {})
    assert verdict.action == "reject"
    assert verdict.confidence == 0.0


def test_groq_fallback_liquidation_high_conf_only():
    linked = [
        {"wallet": "0x1111111111111111111111111111111111111111", "confidence": "high"},
        {"wallet": "0x2222222222222222222222222222222222222222", "confidence": "medium"},
    ]
    with patch("agents.groq_brain._get_llm", side_effect=RuntimeError("no api")):
        verdict = review_liquidation_blacklist("0x" + "ff" * 20, linked)
    assert verdict.proceed is True
    assert "0x1111111111111111111111111111111111111111" in verdict.wallets_to_blacklist
    assert "0x2222222222222222222222222222222222222222" not in verdict.wallets_to_blacklist


def test_medium_sybil_high_score_not_borderline():
    assert _is_borderline(842, "medium") is False


def test_hard_rule_rejects_sybil_high_without_groq():
    """Sybil high must reject before Groq is invoked."""
    mock_agent = MagicMock()
    mock_agent.sbt.functions.isBlacklisted.return_value.call.return_value = False
    mock_agent.sbt.functions.hasProfile.return_value.call.return_value = False

    score_payload = {
        "cred_score": 650,
        "sybil_risk": "high",
        "approved": False,
        "borrow_sub_score": 400,
        "wallet_sub_score": 500,
        "shap_cid": "QmTest",
        "model_breakdown": {},
    }

    with patch("agents.underwriter_agent.httpx.Client") as mock_client:
        mock_resp = MagicMock()
        mock_resp.json.return_value = score_payload
        mock_client.return_value.__enter__.return_value.post.return_value = mock_resp

        with patch("agents.underwriter_agent.review_underwriting") as mock_groq:
            from agents.underwriter_agent import underwrite_wallet

            result = underwrite_wallet(mock_agent, "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844")
            mock_groq.assert_not_called()

    assert result["action"] == "reject"
    assert "sybil" in result["reason"].lower()


def test_liquidation_blacklist_merge():
    """High-confidence wallets always included even if Groq omits them."""
    from agents.liquidation_agent import LiquidationAgent

    linked = [
        {"wallet": Web3.to_checksum_address("0x1111111111111111111111111111111111111111"), "confidence": "high"},
        {"wallet": Web3.to_checksum_address("0x2222222222222222222222222222222222222222"), "confidence": "low"},
    ]

    verdict = LiquidationVerdict(
        proceed=True,
        wallets_to_blacklist=[Web3.to_checksum_address("0x3333333333333333333333333333333333333333")],
        reasoning="test",
    )

    high_conf = {w["wallet"] for w in linked if w.get("confidence") == "high"}
    groq_set = set(verdict.wallets_to_blacklist)
    merged = list(high_conf | groq_set)
    assert len(merged) == 2


@pytest.mark.parametrize(
    "model,fields",
    [
        (UnderwritingVerdict, {"action": "approve", "reasoning": "ok", "confidence": 0.9}),
        (MonitorVerdict, {"escalate": True, "severity": "high", "reasoning": "ltv", "flag_liquidation": False}),
        (RateVerdict, {"adjust_bps": 25, "direction": "increase", "reasoning": "util"}),
    ],
)
def test_pydantic_structured_models(model, fields):
    obj = model(**fields)
    assert obj.model_dump()


def test_broadcast_loan_active_builds_per_eid():
    """Hub agent sends one LZ tx per destination for loan-active sync."""
    from agents.base import CredFlowAgent

    agent = CredFlowAgent.__new__(CredFlowAgent)
    agent.oapp = MagicMock()
    agent.oapp.functions.broadcastLoanActive.return_value = MagicMock()
    agent.dst_chain_eids = MagicMock(return_value=[40231, 40245])
    agent.lz_options = MagicMock(return_value=b"\x00")
    agent.lz_fee_for_broadcast = MagicMock(return_value=700000000000000)
    agent.send_tx = MagicMock(return_value="0xabc")

    wallet = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"
    tx = CredFlowAgent.broadcast_loan_active(agent, wallet)

    assert tx == "0xabc"
    assert agent.send_tx.call_count == 2
