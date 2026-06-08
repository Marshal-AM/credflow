"""Tests for feature engineering."""

from ml.constants import FEATURE_COLUMNS
from ml.feature_engineering import build_feature_vector
from indexer.mock_data import mock_alchemy_state, mock_borrow_features, mock_wallet_features


def test_build_feature_vector_schema():
    features = build_feature_vector(
        wallet_address="0x" + "1" * 40,
        borrow_features=mock_borrow_features(),
        wallet_features=mock_wallet_features(),
        alchemy_state=mock_alchemy_state(),
    )
    assert len(FEATURE_COLUMNS) == 37
    for col in FEATURE_COLUMNS:
        assert col in features
        assert features[col] is not None


def test_build_feature_vector_empty_inputs():
    features = build_feature_vector(
        wallet_address="0x" + "2" * 40,
        borrow_features={},
        wallet_features={},
        alchemy_state={},
    )
    assert features["repay_ratio"] == 0.5
    assert features["wallet_age_flag"] == 1
    assert features["morpho_borrow_count"] == 0
    assert features["credflow_borrow_count"] == 0
