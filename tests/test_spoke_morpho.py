"""Tests for Morpho Blue indexing (Base Sepolia only)."""

from unittest.mock import MagicMock, patch

from indexer.chains import MORPHO_SPOKE_KEYS, morpho_spoke_chains
from indexer.morpho_pipeline import (
    MORPHO_BLUE,
    MORPHO_COLLATERAL_TOKEN,
    MORPHO_LOAN_TOKEN,
    _asset_for_action,
    _fetch_morpho_events,
    fetch_morpho_spoke_features,
)
from indexer.spoke_pipeline import _topic_hex


def test_morpho_spoke_chains_base_sepolia_only():
    keys = {c.key for c in morpho_spoke_chains()}
    assert keys == {"base_sepolia"}
    assert MORPHO_SPOKE_KEYS == frozenset({"base_sepolia"})
    assert "arbitrum_sepolia" not in keys


def _borrow_log(tx_hash="0xabc", block="0x3039", market_id="0x" + "ab" * 32):
    return {
        "address": MORPHO_BLUE,
        "topics": [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            market_id,
            "0x" + "00" * 12 + "1" * 40,
            "0x" + "00" * 12 + "2" * 40,
        ],
        "data": "0x" + "00" * 64,
        "blockNumber": block,
        "transactionHash": tx_hash,
        "logIndex": "0x0",
    }


@patch("indexer.morpho_pipeline._etherscan_get_logs")
@patch("indexer.morpho_pipeline._morpho_from_block", return_value=0)
def test_fetch_morpho_events_returns_only_labeled_actions(_mock_from_block, mock_get_logs):
    w3 = MagicMock()
    morpho = MagicMock()
    w3.eth.contract.return_value = morpho

    borrow_event = MagicMock()
    borrow_event.topic = bytes.fromhex("a5f2790a00000000000000000000000000000000000000000000000000000000"[:64])
    borrow_event.process_log.return_value = {
        "args": {"id": bytes.fromhex("ab" * 32)},
        "transactionHash": "0xabc",
        "blockNumber": 12345,
    }

    for name in ("SupplyCollateral", "WithdrawCollateral", "Repay"):
        evt = MagicMock()
        evt.topic = bytes.fromhex("00" * 32)
        evt.process_log.side_effect = ValueError(f"not a {name} log")
        setattr(morpho.events, name, evt)

    morpho.events.Borrow = borrow_event
    create_market_topic = "0x" + "11" * 32
    morpho.events.CreateMarket = MagicMock()
    morpho.events.CreateMarket.topic = bytes.fromhex("11" * 32)
    morpho.events.CreateMarket.process_log.return_value = {
        "args": {
            "marketParams": (
                MORPHO_LOAN_TOKEN,
                MORPHO_COLLATERAL_TOKEN,
                "0x" + "3" * 40,
                "0x" + "4" * 40,
                0,
            )
        }
    }

    def get_logs_side_effect(_chain_id, params):
        topic0 = params.get("topic0")
        # Borrow queries filter wallet on topic3 (see _EVENT_TOPIC_QUERIES)
        if topic0 == _topic_hex(borrow_event.topic) and params.get("topic3"):
            return [_borrow_log()]
        # CreateMarket lookup for market params resolution
        if topic0 == create_market_topic and params.get("topic1"):
            return [
                {
                    "address": MORPHO_BLUE,
                    "topics": [create_market_topic, "0x" + "ab" * 32],
                    "data": "0x",
                    "blockNumber": "0x3039",
                    "transactionHash": "0xabc",
                    "logIndex": "0x0",
                }
            ]
        return []

    mock_get_logs.side_effect = get_logs_side_effect
    w3.eth.get_block.return_value = {"timestamp": 1_700_000_000}

    rows = _fetch_morpho_events(w3, "0x" + "1" * 40, "base_sepolia")
    assert len(rows) == 1
    assert rows[0]["action"] == "Borrow"
    assert rows[0]["action"] != "Unknown"
    assert rows[0]["asset"] == "usdc"
    assert rows[0]["protocol"] == "morpho"


def test_asset_for_action_uses_market_params():
    markets = {
        "0xmarket": {
            "loanToken": MORPHO_LOAN_TOKEN,
            "collateralToken": MORPHO_COLLATERAL_TOKEN,
        }
    }
    assert _asset_for_action("Borrow", "0xmarket", markets) == "usdc"
    assert _asset_for_action("Supply", "0xmarket", markets) == "weth"


@patch("indexer.morpho_pipeline._etherscan_get_logs")
@patch("indexer.morpho_pipeline._morpho_from_block", return_value=0)
def test_fetch_morpho_events_dedupes_borrow_on_behalf_and_receiver(_mock_from_block, mock_get_logs):
    w3 = MagicMock()
    morpho = MagicMock()
    w3.eth.contract.return_value = morpho

    borrow_event = MagicMock()
    borrow_event.topic = bytes.fromhex("aa" * 32)
    borrow_event.process_log.return_value = {
        "args": {"id": bytes.fromhex("ab" * 32)},
        "transactionHash": "0xabc",
        "blockNumber": 12345,
    }

    for name in ("SupplyCollateral", "WithdrawCollateral", "Repay"):
        evt = MagicMock()
        evt.topic = bytes.fromhex("00" * 32)
        setattr(morpho.events, name, evt)
    morpho.events.Borrow = borrow_event
    morpho.events.CreateMarket = MagicMock()
    morpho.events.CreateMarket.topic = bytes.fromhex("11" * 32)

    from indexer.morpho_pipeline import _topic_hex

    def get_logs_side_effect(_chain_id, params):
        if params.get("topic0") == _topic_hex(borrow_event.topic):
            return [_borrow_log(), _borrow_log()]
        return []

    mock_get_logs.side_effect = get_logs_side_effect
    w3.eth.get_block.return_value = {"timestamp": 1_700_000_000}

    rows = _fetch_morpho_events(w3, "0x" + "2" * 40, "base_sepolia")
    assert len(rows) == 1


@patch("indexer.morpho_pipeline._use_mock_data", return_value=False)
@patch("indexer.morpho_pipeline._etherscan_api_key", return_value="test-key")
@patch("indexer.morpho_pipeline.morpho_spoke_chains")
@patch("indexer.morpho_pipeline._morpho_deployed", return_value=True)
@patch("indexer.morpho_pipeline._web3_for_chain")
@patch("indexer.morpho_pipeline._fetch_morpho_events")
def test_fetch_morpho_spoke_features_only_queries_morpho_chains(
    mock_events,
    mock_web3,
    _mock_deployed,
    mock_morpho_chains,
    _mock_api_key,
    _mock_flag,
):
    from indexer.chains import CREDFLOW_CHAINS

    mock_morpho_chains.return_value = [c for c in CREDFLOW_CHAINS if c.key == "base_sepolia"]

    w3 = MagicMock()
    morpho = MagicMock()
    w3.eth.contract.return_value = morpho
    w3.eth.get_code.return_value = b"\x01"
    mock_web3.return_value = w3
    mock_events.return_value = [
        {
            "action": "Borrow",
            "chain": "base_sepolia",
            "block": 1,
            "market_id": "0x" + "aa" * 32,
            "hash": "0x1",
        }
    ]

    rows = fetch_morpho_spoke_features("0x" + "1" * 40)
    assert len(rows) == 1
    assert rows[0]["chain"] == "base_sepolia"
    assert rows[0]["protocol"] == "morpho"
    assert rows[0]["morpho_borrow_count"] == 1
    assert rows[0]["backend"] == "etherscan_v2_event_logs"
    assert mock_events.call_count == 1
