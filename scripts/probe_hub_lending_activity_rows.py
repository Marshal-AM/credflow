"""Probe: build CredFlow hub lending activity_rows from LoanCreated/Repaid events."""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()

from indexer.features_pipeline import fetch_borrow_features
from indexer.robinhood_pipeline import fetch_credflow_lending_features

DEFAULT_WALLET = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"


def main() -> int:
    wallet = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_WALLET).lower()

    hub = fetch_credflow_lending_features(wallet)
    merged = fetch_borrow_features(wallet)

    hub_rows = hub.get("activity_rows") or []
    merged_rows = merged.get("activity_rows") or []

    print(f"wallet: {wallet}")
    print()
    print("CURRENT hub lending (no activity_rows field):")
    print(f"  aave_borrow_count: {hub.get('aave_borrow_count', hub.get('total_borrows'))}")
    print(f"  aave_repay_count: {hub.get('aave_repay_count', hub.get('on_time_repayments'))}")
    print(f"  activity_rows: {len(hub_rows)}")
    print()
    print("MERGED borrow_history:")
    print(f"  aave_borrow_count: {merged.get('aave_borrow_count')}")
    print(f"  activity_rows: {len(merged_rows)}")
    for row in merged_rows:
        print(
            f"    - {row.get('action')} block={row.get('block')} "
            f"chain={row.get('chain', '?')} hash={str(row.get('hash', ''))[:18]}..."
        )

    hub_borrows = int(hub.get("aave_borrow_count", hub.get("total_borrows", 0)) or 0)
    merged_hub_borrow_rows = [r for r in merged_rows if r.get("chain") == "robinhood_testnet" and r.get("action") == "Borrow"]

    if hub_borrows > 0 and not hub_rows:
        print()
        print("FAIL: hub has borrows but activity_rows missing from hub source")
        return 1

    if hub_borrows > 0 and not merged_hub_borrow_rows:
        print()
        print("FAIL: hub borrows not present in merged activity_rows")
        return 1

    if hub_rows:
        print()
        print(f"OK: hub activity_rows present ({len(hub_rows)} rows)")
        return 0

    print()
    print("OK: no hub lending activity for this wallet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
