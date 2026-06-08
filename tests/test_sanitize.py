"""Tests for API source_data sanitization."""

from indexer.sanitize import redact_rpc_url, sanitize_source_payload


def test_redact_alchemy_rpc_url():
    url = "https://arb-sepolia.g.alchemy.com/v2/secret-key-123"
    assert redact_rpc_url(url) == "https://arb-sepolia.g.alchemy.com/v2/***"


def test_sanitize_source_payload_redacts_nested_rpc():
    payload = {
        "sources": {
            "alchemy_arbitrum_sepolia": {
                "data": {
                    "_rpc": "https://arb-sepolia.g.alchemy.com/v2/secret-key-123",
                    "tx_count": 1,
                }
            }
        }
    }
    clean = sanitize_source_payload(payload)
    assert "secret-key-123" not in str(clean)
    assert clean["sources"]["alchemy_arbitrum_sepolia"]["data"]["_rpc"].endswith("/***")
