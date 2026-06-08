"""Tests for spoke Aave indexing (Base + Arbitrum Sepolia)."""

from unittest.mock import MagicMock, patch

from indexer.spoke_pipeline import (
    SPOKE_AAVE_POOLS,
    _parse_aave_activity,
    fetch_aave_spoke_features,
)


def test_spoke_aave_pools_include_arbitrum_and_base():
    assert "arbitrum_sepolia" in SPOKE_AAVE_POOLS
    assert "base_sepolia" in SPOKE_AAVE_POOLS
    assert SPOKE_AAVE_POOLS["arbitrum_sepolia"].lower() == (
        "0xbfC91D59fdAA134A4ED45f7B584cAf96D7792Eff".lower()
    )


def test_parse_aave_activity_tags_chain_and_asset():
    w3 = MagicMock()
    w3.eth.get_transaction_receipt.return_value = {
        "blockNumber": 275024137,
        "logs": [
            {
                "address": "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff",
                "topics": [
                    "0xb3d084820fb1a9decffb176436bd02b9f48dd2df1bd1977aa3d02e9d0a5b2e46"
                ],
            }
        ],
    }
    w3.eth.get_transaction.return_value = {"input": "0x"}
    w3.eth.get_block.return_value = {"timestamp": 1_700_000_000}

    rows = _parse_aave_activity(
        w3,
        [
            {
                "hash": "0xabc",
                "rawContract": {"address": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"},
            }
        ],
        "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff",
        "arbitrum_sepolia",
    )
    assert len(rows) == 1
    assert rows[0]["action"] == "Borrow"
    assert rows[0]["chain"] == "arbitrum_sepolia"
    assert rows[0]["asset"] == "usdc"


@patch("indexer.spoke_pipeline._use_mock_data", return_value=False)
@patch("indexer.spoke_pipeline.spoke_chains")
@patch("indexer.spoke_pipeline.chain_alchemy_rpc_url", return_value="https://arb-sepolia.g.alchemy.com/v2/test")
@patch("indexer.spoke_pipeline._web3_for_chain")
@patch("indexer.spoke_pipeline._fetch_wallet_pool_transfers")
@patch("indexer.spoke_pipeline._parse_aave_activity")
def test_fetch_aave_spoke_features_iterates_configured_pools(
    mock_parse,
    mock_transfers,
    mock_web3,
    _mock_alchemy,
    mock_spoke_chains,
    _mock_flag,
):
    from indexer.chains import CREDFLOW_CHAINS

    mock_spoke_chains.return_value = [c for c in CREDFLOW_CHAINS if c.role == "spoke"]

    w3 = MagicMock()
    pool = MagicMock()
    pool.functions.getUserAccountData.return_value.call.return_value = (1, 0, 0, 0, 0, 2**256 - 1)
    w3.eth.contract.return_value = pool
    mock_web3.return_value = w3
    mock_transfers.return_value = [{"hash": "0x1"}]
    mock_parse.return_value = [{"action": "Supply", "chain": "arbitrum_sepolia", "block": 1}]

    rows = fetch_aave_spoke_features("0x" + "1" * 40)
    chains = {row["chain"] for row in rows}
    assert "arbitrum_sepolia" in chains
    assert "base_sepolia" in chains
    assert mock_transfers.call_count == 2
