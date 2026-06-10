"""Collect raw data from every indexer source (for debugging / transparency)."""

from __future__ import annotations

import logging
import os
from typing import Any

from indexer.chains import MORPHO_SPOKE_KEYS, hub_chain, spoke_chains
from indexer.sanitize import sanitize_source_payload
from indexer.robinhood_pipeline import (
    fetch_credflow_lending_features,
    fetch_robinhood_wallet_features,
)
from indexer.spoke_credflow_pipeline import fetch_spoke_credflow_lending_features
from indexer.morpho_pipeline import fetch_morpho_spoke_features
from indexer.spoke_pipeline import (
    SPOKE_AAVE_POOLS,
    fetch_aave_spoke_features,
    fetch_spoke_wallet_features,
)

logger = logging.getLogger(__name__)


def _source_entry(
    *,
    source_id: str,
    chain: str,
    backend: str,
    data: dict | list | None,
    skipped: bool = False,
    skip_reason: str | None = None,
) -> dict:
    payload = data if data is not None else {}
    has_data = bool(payload) and not skipped
    return {
        "source_id": source_id,
        "chain": chain,
        "backend": backend,
        "skipped": skipped,
        "skip_reason": skip_reason,
        "has_data": has_data,
        "data": payload,
    }


def collect_all_sources(wallet_address: str, borrow_features: dict | None = None) -> dict[str, Any]:
    """Return every individual source payload before merge/feature engineering."""
    if os.environ.get("USE_MOCK_DATA", "0") == "1":
        from indexer.mock_data import (
            mock_alchemy_state,
            mock_borrow_features,
            mock_wallet_features,
        )

        return {
            "sources": {
                "mock_wallet": _source_entry(
                    source_id="mock_wallet",
                    chain="mock",
                    backend="mock",
                    data=mock_wallet_features(),
                ),
                "mock_borrow": _source_entry(
                    source_id="mock_borrow",
                    chain="mock",
                    backend="mock",
                    data=mock_borrow_features(),
                ),
                "mock_alchemy": _source_entry(
                    source_id="mock_alchemy",
                    chain="mock",
                    backend="mock",
                    data=mock_alchemy_state(),
                ),
                "borrow_history_merged": _source_entry(
                    source_id="borrow_history_merged",
                    chain="multi",
                    backend="mock",
                    data=mock_borrow_features(),
                ),
            },
        }

    sources: dict[str, dict] = {}

    hub_wallet = fetch_robinhood_wallet_features(wallet_address)
    sources["robinhood_wallet_rpc"] = _source_entry(
        source_id="robinhood_wallet_rpc",
        chain=hub_chain().key,
        backend=hub_wallet.get("backend", "rpc"),
        data=hub_wallet,
    )
    sources["robinhood_credflow_lending"] = _source_entry(
        source_id="robinhood_credflow_lending",
        chain=hub_chain().key,
        backend="rpc_events",
        data=fetch_credflow_lending_features(wallet_address),
    )

    for chain in spoke_chains():
        spoke_credflow = fetch_spoke_credflow_lending_features(wallet_address, chain.key)
        sources[f"{chain.key}_credflow_lending"] = _source_entry(
            source_id=f"{chain.key}_credflow_lending",
            chain=chain.key,
            backend=spoke_credflow.get("backend", "rpc_loan_counter"),
            data=spoke_credflow,
        )

    for chain in spoke_chains():
        sources[f"{chain.key}_wallet_rpc"] = _source_entry(
            source_id=f"{chain.key}_wallet_rpc",
            chain=chain.key,
            backend="rpc+alchemy_transfers",
            data=fetch_spoke_wallet_features(chain, wallet_address),
        )

    aave_spoke_rows = fetch_aave_spoke_features(wallet_address)
    aave_by_chain = {row.get("chain"): row for row in aave_spoke_rows}
    for chain in spoke_chains():
        pool = SPOKE_AAVE_POOLS.get(chain.key)
        if not pool:
            sources[f"{chain.key}_aave_rpc"] = _source_entry(
                source_id=f"{chain.key}_aave_rpc",
                chain=chain.key,
                backend="rpc_events",
                data={},
                skipped=True,
                skip_reason="No Aave pool configured for this spoke",
            )
        else:
            row = aave_by_chain.get(chain.key, {})
            sources[f"{chain.key}_aave_rpc"] = _source_entry(
                source_id=f"{chain.key}_aave_rpc",
                chain=chain.key,
                backend=row.get("backend", "alchemy_transfers+receipt_logs"),
                data=row,
            )

    morpho_spoke_rows = fetch_morpho_spoke_features(wallet_address)
    morpho_by_chain = {row.get("chain"): row for row in morpho_spoke_rows}
    for chain in spoke_chains():
        if chain.key in MORPHO_SPOKE_KEYS:
            row = morpho_by_chain.get(chain.key, {})
            sources[f"{chain.key}_morpho_rpc"] = _source_entry(
                source_id=f"{chain.key}_morpho_rpc",
                chain=chain.key,
                backend=row.get("backend", "etherscan_v2_event_logs"),
                data=row,
            )
        else:
            sources[f"{chain.key}_morpho_rpc"] = _source_entry(
                source_id=f"{chain.key}_morpho_rpc",
                chain=chain.key,
                backend="rpc_events",
                data={},
                skipped=True,
                skip_reason="Morpho Blue is not deployed on this testnet",
            )

    from indexer.alchemy_pipeline import fetch_chain_state

    for chain in spoke_chains() + [hub_chain()]:
        state = fetch_chain_state(chain, wallet_address)
        sources[f"alchemy_{chain.key}"] = _source_entry(
            source_id=f"alchemy_{chain.key}",
            chain=chain.key,
            backend="rpc" if "alchemy.com" not in str(state.get("_rpc", "")) else "alchemy",
            data={
                k: v
                for k, v in state.items()
                if k != "recent_transactions"
            }
            | {
                "recent_tx_count": len(state.get("recent_transactions", [])),
                "recent_transactions_sample": (state.get("recent_transactions") or [])[:3],
            },
        )

    if borrow_features is None:
        from indexer.features_pipeline import fetch_borrow_features

        borrow_features = fetch_borrow_features(wallet_address)

    sources["borrow_history_merged"] = _source_entry(
        source_id="borrow_history_merged",
        chain="multi",
        backend="merged",
        data=borrow_features,
    )

    active = [s for s in sources.values() if s.get("has_data")]
    skipped = [s for s in sources.values() if s.get("skipped")]

    payload = {
        "summary": {
            "total_sources": len(sources),
            "sources_with_data": len(active),
            "sources_skipped": len(skipped),
            "active_source_ids": [s["source_id"] for s in active],
        },
        "sources": sources,
    }
    return sanitize_source_payload(payload)
