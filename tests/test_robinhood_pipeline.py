"""Tests for Robinhood hub wallet + lending indexers."""

from unittest.mock import MagicMock, patch

from indexer.aggregate import merge_borrow_features
from indexer.robinhood_pipeline import _wallet_transfer_features, fetch_robinhood_wallet_features


def test_wallet_transfer_features_from_alchemy_shape():
    wallet = "0x2514844f312c02ae3c9d4feb40db4ec8830b6844"
    transfers = [
        {
            "from": "0x0000000000000000000000000000000000000000",
            "to": wallet,
            "metadata": {"blockTimestamp": "2026-06-08T01:16:41Z"},
        },
        {
            "from": wallet,
            "to": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            "metadata": {"blockTimestamp": "2026-06-08T03:48:53Z"},
        },
    ]
    features = _wallet_transfer_features(wallet, transfers)
    assert len(features["transfer_timestamps"]) == 2
    assert features["unique_protocols"] == 1
    assert "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" in features["unique_contract_addresses"]


@patch("indexer.robinhood_pipeline._use_mock_data", return_value=False)
@patch("indexer.robinhood_pipeline._web3")
@patch("indexer.robinhood_pipeline._hub_alchemy_transfers")
def test_fetch_robinhood_wallet_features_uses_alchemy(mock_transfers, mock_web3, _mock_flag):
    wallet = "0x2514844f312c02ae3c9d4feb40db4ec8830b6844"
    mock_transfers.return_value = [
        {
            "from": "0x0000000000000000000000000000000000000000",
            "to": wallet,
            "metadata": {"blockTimestamp": "2026-06-08T01:16:41Z"},
        }
    ]
    w3 = MagicMock()
    w3.eth.get_transaction_count.return_value = 19
    mock_web3.return_value = w3

    result = fetch_robinhood_wallet_features(wallet)
    assert result["backend"] == "alchemy_transfers"
    assert result["wallet_first_seen"] == "2026-06-08T01:16:41"
    assert result["tx_count"] == 19


def test_merge_borrow_features_includes_hub_activity_rows():
    merged = merge_borrow_features(
        [
            {
                "chain": "robinhood_testnet",
                "credflow_borrow_count": 1,
                "credflow_repay_count": 0,
                "activity_rows": [
                    {
                        "chain": "robinhood_testnet",
                        "action": "Borrow",
                        "block": 100,
                        "hash": "0xhub",
                    }
                ],
            },
            {
                "chain": "base_sepolia",
                "aave_borrow_count": 1,
                "aave_repay_count": 1,
                "activity_rows": [
                    {
                        "chain": "base_sepolia",
                        "action": "Borrow",
                        "block": 200,
                        "hash": "0xbase",
                    }
                ],
            },
        ]
    )
    assert merged["total_borrow_count"] == 2
    assert merged["credflow_borrow_count"] == 1
    assert merged["aave_borrow_count"] == 1
    assert len(merged["activity_rows"]) == 2
    assert merged["activity_rows"][0]["chain"] == "robinhood_testnet"
    assert merged["activity_rows"][1]["chain"] == "base_sepolia"
