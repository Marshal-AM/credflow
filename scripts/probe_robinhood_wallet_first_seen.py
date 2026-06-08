"""Probe: Robinhood hub wallet_first_seen via Alchemy transfers (scripts/robinhoodtx.js)."""

from __future__ import annotations

import os
import sys
import time

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()

from indexer.chains import chain_alchemy_rpc_url, hub_chain
from indexer.robinhood_pipeline import _hub_alchemy_transfers, fetch_robinhood_wallet_features

DEFAULT_WALLET = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"


def main() -> int:
    wallet = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_WALLET).lower()
    alchemy = chain_alchemy_rpc_url(hub_chain())
    if not alchemy:
        print("FAIL: ALCHEMY_API_KEY not set (needed for robinhood-testnet.g.alchemy.com)")
        return 1

    t0 = time.perf_counter()
    transfers = _hub_alchemy_transfers(wallet)
    t1 = time.perf_counter()
    features = fetch_robinhood_wallet_features(wallet)
    t2 = time.perf_counter()

    print(f"wallet: {wallet}")
    print(f"alchemy_rpc: {alchemy.replace(os.environ.get('ALCHEMY_API_KEY', ''), '***')}")
    print(f"transfers: {len(transfers)}  fetch_time: {t2 - t0:.2f}s")
    print()
    print("fetch_robinhood_wallet_features:")
    print(f"  backend: {features.get('backend')}")
    print(f"  wallet_first_seen: {features.get('wallet_first_seen')}")
    print(f"  wallet_last_active: {features.get('wallet_last_active')}")
    print(f"  transfer_timestamps: {len(features.get('transfer_timestamps') or [])}")
    print(f"  unique_contracts: {len(features.get('unique_contract_addresses') or [])}")

    if not features.get("wallet_first_seen"):
        print()
        print("FAIL: wallet_first_seen missing")
        return 1

    if features.get("backend") != "alchemy_transfers":
        print()
        print("FAIL: expected backend=alchemy_transfers")
        return 1

    print()
    print("OK: hub wallet_first_seen from Alchemy transfers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
