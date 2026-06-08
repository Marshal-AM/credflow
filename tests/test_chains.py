"""Tests for multi-chain indexer configuration."""

from indexer.aggregate import merge_borrow_features, merge_wallet_features
from indexer.chains import (
    CREDFLOW_CHAINS,
    MORPHO_SPOKE_KEYS,
    chain_alchemy_rpc_url,
    chain_rpc_url,
    hub_chain,
    morpho_spoke_chains,
    spoke_chains,
)


def test_credflow_chain_topology():
    assert hub_chain().key == "robinhood_testnet"
    assert hub_chain().chain_id == 46630
    spoke_keys = {c.key for c in spoke_chains()}
    assert spoke_keys == {"arbitrum_sepolia", "base_sepolia"}
    assert len(CREDFLOW_CHAINS) == 3
    assert MORPHO_SPOKE_KEYS == frozenset({"base_sepolia"})
    assert {c.key for c in morpho_spoke_chains()} == {"base_sepolia"}


def test_merge_wallet_features_across_chains():
    merged = merge_wallet_features(
        [
            {
                "chain": "robinhood_testnet",
                "tx_count": 5,
                "unique_protocols": 2,
                "wallet_first_seen": "2025-01-01T00:00:00",
                "wallet_last_active": "2025-06-01T00:00:00",
            },
            {
                "chain": "arbitrum_sepolia",
                "tx_count": 3,
                "unique_protocols": 1,
                "wallet_first_seen": "2025-03-01T00:00:00",
                "wallet_last_active": "2025-05-01T00:00:00",
            },
        ]
    )
    assert merged["tx_count"] == 8
    assert merged["unique_protocols"] == 3
    assert "robinhood_testnet" in merged["chains_with_activity"]


def test_chain_rpc_url_prefers_robinhood_direct_over_alchemy(monkeypatch):
    monkeypatch.setenv("ALCHEMY_API_KEY", "test-key")
    monkeypatch.setenv("RPC_ROBINHOOD", "https://rpc.testnet.chain.robinhood.com")
    assert chain_rpc_url(hub_chain()) == "https://rpc.testnet.chain.robinhood.com"

    monkeypatch.setenv("RPC_ARBITRUM_SEPOLIA", "https://sepolia-rollup.arbitrum.io/rpc")
    assert "alchemy.com" in chain_rpc_url(spoke_chains()[0])


def test_chain_alchemy_rpc_url_includes_robinhood_hub(monkeypatch):
    monkeypatch.setenv("ALCHEMY_API_KEY", "test-key")
    url = chain_alchemy_rpc_url(hub_chain())
    assert url == "https://robinhood-testnet.g.alchemy.com/v2/test-key"


def test_merge_borrow_features_across_chains():
    merged = merge_borrow_features(
        [
            {"chain": "robinhood_testnet", "credflow_borrow_count": 1, "credflow_repay_count": 1},
            {"chain": "base_sepolia", "aave_borrow_count": 2, "aave_repay_count": 2},
        ]
    )
    assert merged["total_borrow_count"] == 3
    assert merged["total_repay_count"] == 3
