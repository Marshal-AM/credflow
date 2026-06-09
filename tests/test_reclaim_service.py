"""Tests for Reclaim balance parsing and FX conversion."""

import os

import pytest

from ml.reclaim_service import (
    _parse_helper_stdout,
    inr_to_usd_cents,
    parse_balance_inr,
    process_proof_callback,
)


def test_parse_helper_stdout_with_embedded_braces():
    payload = '{"requestUrl":"x","config":"{\\"nested\\":{\\"a\\":1}}"}'
    assert _parse_helper_stdout(payload)["config"] == '{"nested":{"a":1}}'


def test_parse_helper_stdout_with_log_prefix():
    payload = 'current level info\n{"valid":true,"extractedParameters":{"balance":"100"}}'
    assert _parse_helper_stdout(payload)["valid"] is True


def test_parse_balance_inr_formats():
    assert parse_balance_inr({"balance": "₹1,24,500.00"}) == 124500.0
    assert parse_balance_inr({"accountBalance": "5000"}) == 5000.0
    assert parse_balance_inr({}) == 0.0


def test_inr_to_usd_cents():
    # ₹96,000 at ₹96/USD = $1000
    cents = inr_to_usd_cents(96000, 96)
    assert cents == 100000


@pytest.mark.parametrize("mock_inr", ["50000"])
def test_mock_reclaim_callback(monkeypatch, mock_inr):
    monkeypatch.setenv("USE_MOCK_RECLAIM", "1")
    monkeypatch.setenv("MOCK_RECLAIM_BALANCE_INR", mock_inr)
    monkeypatch.setenv("INR_PER_USD", "100")

    from ml import reclaim_service

    reclaim_service._sessions.clear()
    session = process_proof_callback("{}", wallet_hint="0x1234567890123456789012345678901234567890")
    assert session.status == "verified"
    assert session.balance_inr_paise == int(float(mock_inr) * 100)
    assert session.balance_usd_cents > 0
    assert session.proof_hash is not None
