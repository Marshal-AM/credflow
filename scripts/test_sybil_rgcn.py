#!/usr/bin/env python3
"""Live smoke test for R-GCN Sybil detector."""

import argparse
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()


def main():
    parser = argparse.ArgumentParser(description="Run R-GCN sybil check on a wallet")
    parser.add_argument("wallet", help="Wallet address to analyze")
    parser.add_argument("--mock", action="store_true", help="Use mock Alchemy state")
    args = parser.parse_args()

    from pathlib import Path

    from ml.constants import SYBIL_MODEL_PATH
    from ml.sybil_detector import build_transaction_graph, run_sybil_check

    if not Path(SYBIL_MODEL_PATH).exists():
        print(f"Sybil model not found at {SYBIL_MODEL_PATH}")
        print("Run: npm run ml:train  (or npm run ml:sybil-train)")
        sys.exit(1)

    if args.mock:
        os.environ["USE_MOCK_DATA"] = "1"
        from indexer.mock_data import mock_alchemy_state

        alchemy_state = mock_alchemy_state()
        print("Using mock Alchemy state")
    else:
        os.environ["USE_MOCK_DATA"] = "0"
        from indexer.alchemy_pipeline import get_wallet_state

        alchemy_state = get_wallet_state(args.wallet)
        print(f"Chains queried: {alchemy_state.get('chains', [])}")
        print(f"Recent transactions: {len(alchemy_state.get('recent_transactions', []))}")

    graph = build_transaction_graph(args.wallet, alchemy_state)
    print(f"Graph nodes: {graph['num_nodes']}")
    print(f"Unique counterparties: {graph['unique_counterparties']}")
    print(f"Defaulter links: {graph['defaulter_links']}")

    result = run_sybil_check(args.wallet, alchemy_state)
    print(f"Sybil risk: {result['sybil_risk']}")
    print(f"Method: {result['method']}")
    if "sybil_probs" in result:
        probs = result["sybil_probs"]
        print(
            f"Probabilities: low={probs['low']:.3f} medium={probs['medium']:.3f} "
            f"high={probs['high']:.3f}"
        )
    if result["method"] != "rgcn":
        print("Note: inference used fallback path (defaulter_link or heuristic)")


if __name__ == "__main__":
    main()
