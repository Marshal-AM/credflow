#!/usr/bin/env python3
"""Train R-GCN Sybil detector on synthetic graph data."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ml.sybil_detector import train_sybil_model


def main():
    path = train_sybil_model()
    print(f"Sybil model trained: {path}")


if __name__ == "__main__":
    main()
