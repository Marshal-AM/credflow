"""Aggregate wallet + borrow features from on-chain RPC indexers (hub + spokes)."""

import logging
import os
import re

from dotenv import load_dotenv

from indexer.aggregate import merge_borrow_features, merge_wallet_features
from indexer.robinhood_pipeline import (
    fetch_credflow_lending_features,
    fetch_robinhood_wallet_features,
)
from indexer.spoke_credflow_pipeline import fetch_all_spoke_credflow_lending_features
from indexer.morpho_pipeline import fetch_morpho_spoke_features
from indexer.spoke_pipeline import fetch_aave_spoke_features, fetch_spoke_wallet_features
from indexer.chains import spoke_chains

load_dotenv()

logger = logging.getLogger(__name__)

_WALLET_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"


def _normalize_wallet(wallet_address: str) -> str:
    address = wallet_address.lower()
    if not _WALLET_RE.match(address):
        raise ValueError(f"Invalid wallet address: {wallet_address}")
    return address


def fetch_wallet_features(wallet_address: str) -> dict:
    """Wallet behavior: Robinhood hub RPC + spoke RPC (Alchemy transfers)."""
    if _use_mock_data():
        from indexer.mock_data import mock_wallet_features

        return mock_wallet_features()

    _normalize_wallet(wallet_address)
    per_chain = [fetch_robinhood_wallet_features(wallet_address)]

    for chain in spoke_chains():
        per_chain.append(fetch_spoke_wallet_features(chain, wallet_address))

    return merge_wallet_features(per_chain)


def fetch_borrow_features(wallet_address: str) -> dict:
    """Borrow history: CredFlow hub lending + Aave spokes + Morpho (Base Sepolia only)."""
    if _use_mock_data():
        from indexer.mock_data import mock_borrow_features

        return mock_borrow_features()

    _normalize_wallet(wallet_address)
    per_chain = [fetch_credflow_lending_features(wallet_address)]
    per_chain.extend(fetch_all_spoke_credflow_lending_features(wallet_address))
    per_chain.extend(fetch_aave_spoke_features(wallet_address))
    per_chain.extend(fetch_morpho_spoke_features(wallet_address))
    return merge_borrow_features(per_chain)
