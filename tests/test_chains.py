"""Tests for multi-chain indexer configuration."""

from indexer.aggregate import merge_borrow_features, merge_wallet_features
from indexer.chains import CREDFLOW_CHAINS, GMX_REPUTATION_CHAIN, hub_chain, spoke_chains


def test_credflow_chain_topology():
    assert hub_chain().key == "robinhood_testnet"
    assert hub_chain().chain_id == 46630
    spoke_keys = {c.key for c in spoke_chains()}
    assert spoke_keys == {"arbitrum_sepolia", "base_sepolia"}
    assert len(CREDFLOW_CHAINS) == 3
    assert GMX_REPUTATION_CHAIN.key == "arbitrum_mainnet"


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


def test_merge_borrow_features_across_chains():
    merged = merge_borrow_features(
        [
            {"chain": "robinhood_testnet", "total_borrows": 1, "on_time_repayments": 1, "liquidation_count": 0},
            {"chain": "dune_aave", "total_borrows": 2, "on_time_repayments": 2, "liquidation_count": 0},
        ]
    )
    assert merged["total_borrows"] == 3
    assert merged["on_time_repayments"] == 3
