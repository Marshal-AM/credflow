#!/usr/bin/env python3
"""Live smoke test for post-default graph analysis."""

import argparse
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()


def main():
    parser = argparse.ArgumentParser(description="Run graph analysis on a wallet address")
    parser.add_argument("wallet", help="Wallet address to analyze")
    parser.add_argument(
        "--depth",
        type=int,
        default=1,
        help="BFS depth: 1=direct counterparties only, 2=+their neighbors (default: 1 for smoke)",
    )
    parser.add_argument(
        "--max-wallets",
        type=int,
        default=15,
        help="Max wallets to visit before stopping (default: 15; 0=unlimited)",
    )
    parser.add_argument(
        "--log-level",
        default=os.environ.get("GRAPH_ANALYSIS_LOG_LEVEL", "INFO"),
        help="Logging level (DEBUG shows every queued neighbor)",
    )
    args = parser.parse_args()

    from ml.graph_analysis import (
        _alchemy_urls,
        configure_graph_logging,
        get_transaction_counterparties,
        identify_linked_wallets,
    )

    configure_graph_logging(args.log_level)

    urls = _alchemy_urls()
    if not urls:
        print("No Alchemy RPC URLs configured.")
        print("Set ALCHEMY_API_KEY and/or ALCHEMY_*_RPC env vars, then retry.")
        sys.exit(1)

    max_wallets = None if args.max_wallets == 0 else args.max_wallets

    print(f"Analyzing wallet: {args.wallet}")
    print(f"Alchemy endpoints: {len(urls)}")
    print(f"Depth: {args.depth} | max_wallets: {max_wallets or 'unlimited'}")
    print("--- Alchemy + BFS logs ---", flush=True)

    graph = get_transaction_counterparties(
        args.wallet,
        depth=args.depth,
        max_wallets=max_wallets,
    )
    print("--- Results ---")
    print(f"Graph nodes: {graph.number_of_nodes()}, edges: {graph.number_of_edges()}")

    linked = identify_linked_wallets(args.wallet, graph)
    print(f"Linked wallets found: {len(linked)}")
    for item in linked:
        print(
            f"  -> {item['wallet']} | reason: {item['reason']} | "
            f"value: {item['value']} | confidence: {item['confidence']}"
        )

    lending_address = os.environ.get("CREDFLOW_LENDING_ADDRESS", "").strip()
    if lending_address and os.environ.get("RPC_ROBINHOOD"):
        from ml.graph_analysis import check_existing_credflow_loans

        at_risk = check_existing_credflow_loans(linked)
        print(f"At-risk active loans: {len(at_risk)}")
        for row in at_risk:
            print(
                f"  -> loan {row['active_loan_id']} for {row['wallet']} "
                f"(borrowed: {row['borrowed_amount']})"
            )
    else:
        print("Skipping on-chain loan check (CREDFLOW_LENDING_ADDRESS or RPC_ROBINHOOD not set)")


if __name__ == "__main__":
    main()
