#!/usr/bin/env python3
"""End-to-end ML training: synthetic data -> XGBoost -> artifacts."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ml.constants import EXPLAINER_PATH, MODEL_PATH, SYNTHETIC_CSV_PATH
from ml.generate_synthetic_data import generate_synthetic_training_csv
from ml.sybil_detector import train_sybil_model
from ml.train_model import train_credflow_model


def main():
    csv_path = generate_synthetic_training_csv()
    _, _, auc = train_credflow_model(csv_path, MODEL_PATH, EXPLAINER_PATH)
    print(f"XGBoost model saved to {MODEL_PATH} (AUC={auc:.4f})")

    try:
        sybil_path = train_sybil_model()
        print(f"Sybil model saved to {sybil_path}")
    except ImportError as exc:
        print(f"Sybil training skipped (torch-geometric not installed): {exc}")

    print("Training complete.")


if __name__ == "__main__":
    main()
