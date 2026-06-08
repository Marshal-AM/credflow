"""Pytest fixtures for ML pipeline tests."""

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["USE_MOCK_DATA"] = "1"


@pytest.fixture(scope="session", autouse=True)
def ensure_models():
    """Train mini models if artifacts missing."""
    from ml.constants import EXPLAINER_PATH, MODEL_PATH, SYBIL_MODEL_PATH, SYNTHETIC_CSV_PATH
    from ml.generate_synthetic_data import generate_synthetic_training_csv
    from ml.train_model import train_credflow_model

    if not Path(MODEL_PATH).exists():
        csv = generate_synthetic_training_csv(n_samples=500, output_path=SYNTHETIC_CSV_PATH)
        train_credflow_model(csv, MODEL_PATH, EXPLAINER_PATH)

    if not Path(SYBIL_MODEL_PATH).exists():
        try:
            from ml.sybil_detector import train_sybil_model

            train_sybil_model(n_samples=50, epochs=5)
        except ImportError:
            pass
