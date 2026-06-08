"""Tests for feature engineering."""

from ml.constants import FEATURE_COLUMNS
from ml.feature_engineering import build_feature_vector
from indexer.mock_data import (
    mock_aave_features,
    mock_alchemy_state,
    mock_fhenix_attestation,
    mock_gmx_history,
    mock_wallet_features,
)


def test_build_feature_vector_schema():
    features = build_feature_vector(
        wallet_address="0x" + "1" * 40,
        dune_aave=mock_aave_features(),
        dune_wallet=mock_wallet_features(),
        alchemy_state=mock_alchemy_state(),
        gmx_data=mock_gmx_history(),
        fhenix_attestation=mock_fhenix_attestation(),
    )
    for col in FEATURE_COLUMNS:
        assert col in features
        assert features[col] is not None


def test_build_feature_vector_empty_inputs():
    features = build_feature_vector(
        wallet_address="0x" + "2" * 40,
        dune_aave={},
        dune_wallet={},
        alchemy_state={},
        gmx_data={},
        fhenix_attestation={},
    )
    assert features["repayment_rate"] == 0.5
    assert features["gmx_sub_score"] == 50.0
