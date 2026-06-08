"""Probe: redact Alchemy API keys from RPC URLs in source payloads."""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

load_dotenv()

from indexer.sanitize import redact_rpc_url, sanitize_source_payload

SAMPLES = [
    "https://arb-sepolia.g.alchemy.com/v2/NMsHzNgJ7XUYtzNyFpEJ8yT4muQ_lkRF",
    "https://rpc.testnet.chain.robinhood.com",
    "",
]


def main() -> int:
    print("redact_rpc_url samples:")
    for url in SAMPLES:
        print(f"  in:  {url or '(empty)'}")
        print(f"  out: {redact_rpc_url(url)}")
        print()

    payload = {
        "chain": "arbitrum_sepolia",
        "_rpc": SAMPLES[0],
        "tx_count": 10,
        "nested": {"_rpc": SAMPLES[0], "value": 1},
    }
    clean = sanitize_source_payload(payload)

    raw_key = "NMsHzNgJ7XUYtzNyFpEJ8yT4muQ_lkRF"
    serialized = str(clean)
    if raw_key in serialized:
        print("FAIL: API key still present after sanitize_source_payload")
        return 1

    if clean.get("_rpc") != redact_rpc_url(SAMPLES[0]):
        print("FAIL: top-level _rpc not redacted correctly")
        return 1

    if clean["nested"]["_rpc"] != redact_rpc_url(SAMPLES[0]):
        print("FAIL: nested _rpc not redacted correctly")
        return 1

    print("OK: sanitize_source_payload redacts _rpc keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
