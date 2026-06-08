"""Dune Analytics pipeline — aggregates wallet + borrow data across CredFlow chains."""

import logging
import os
import re
from typing import Tuple

import pandas as pd
from dotenv import load_dotenv

from indexer.aggregate import merge_borrow_features, merge_wallet_features
from indexer.chains import dune_lending_blockchains, dune_wallet_chains
from indexer.robinhood_pipeline import (
    fetch_credflow_lending_features,
    fetch_robinhood_wallet_features,
)

load_dotenv()

logger = logging.getLogger(__name__)


def _use_mock_data() -> bool:
    return os.environ.get("USE_MOCK_DATA", "0") == "1"

_WALLET_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")

AAVE_QUERY = """
SELECT
    borrower,
    COUNT(*) as total_borrows,
    SUM(CASE WHEN repaid_on_time THEN 1 ELSE 0 END) as on_time_repayments,
    SUM(CASE WHEN liquidated THEN 1 ELSE 0 END) as liquidation_count,
    AVG(loan_duration_days) as avg_loan_duration,
    MAX(borrow_amount_usd) as max_borrow_usd,
    MIN(block_time) as first_borrow_date
FROM aave_v3_arbitrum.borrows
GROUP BY borrower
"""

GMX_QUERY = """
SELECT
    account,
    COUNT(*) as total_positions,
    SUM(CASE WHEN is_liquidated THEN 1 ELSE 0 END) as liquidations,
    AVG(leverage) as avg_leverage,
    AVG(position_duration_hours) as avg_hold_hours,
    SUM(realized_pnl_usd) as total_pnl,
    MIN(block_time) as first_trade_date
FROM gmx_v2_arbitrum.positions
GROUP BY account
"""


def _wallet_sql(table: str, wallet_address: str) -> str:
    return f"""
SELECT
    "from" AS wallet,
    COUNT(DISTINCT "to") AS unique_protocols,
    COUNT(*) AS tx_count,
    MIN(block_time) AS wallet_first_seen,
    MAX(block_time) AS wallet_last_active
FROM {table}
WHERE "from" = {wallet_address}
GROUP BY "from"
"""


def _aave_sql(blockchains: list[str], wallet_address: str) -> str:
    chain_list = ", ".join(f"'{c}'" for c in blockchains)
    return f"""
SELECT
    borrower,
    COUNT(*) AS total_borrows,
    COUNT(*) AS on_time_repayments,
    SUM(CASE WHEN liquidator IS NOT NULL THEN 1 ELSE 0 END) AS liquidation_count,
    30.0 AS avg_loan_duration,
    MAX(amount_usd) AS max_borrow_usd
FROM lending.borrow
WHERE blockchain IN ({chain_list})
  AND project = 'aave'
  AND version = '3'
  AND borrower = {wallet_address}
GROUP BY borrower
"""


def _normalize_wallet(wallet_address: str) -> str:
    address = wallet_address.lower()
    if not _WALLET_RE.match(address):
        raise ValueError(f"Invalid wallet address: {wallet_address}")
    return address


def _get_client():
    from dune_client.client import DuneClient

    api_key = os.environ.get("DUNE_API_KEY")
    if not api_key:
        raise ValueError("DUNE_API_KEY not set")
    return DuneClient(api_key, performance="small")


def _run_sql(client, sql: str) -> list:
    result = client.run_sql(query_sql=sql, performance="small")
    return result.result.rows if result.result else []


def fetch_training_data() -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch historical Aave and GMX data for model training."""
    if _use_mock_data():
        from ml.generate_synthetic_data import generate_synthetic_training_csv

        path = generate_synthetic_training_csv()
        df = pd.read_csv(path)
        return df, pd.DataFrame()

    client = _get_client()
    try:
        aave_rows = _run_sql(client, AAVE_QUERY)
        gmx_rows = _run_sql(client, GMX_QUERY)
        return pd.DataFrame(aave_rows), pd.DataFrame(gmx_rows)
    except Exception as exc:
        logger.warning("Dune fetch_training_data failed: %s", exc)
        return pd.DataFrame(), pd.DataFrame()


def _fetch_dune_wallet_for_chain(client, chain, wallet_address: str) -> dict:
    if not chain.dune_transactions_table:
        return {}
    try:
        sql = _wallet_sql(chain.dune_transactions_table, wallet_address)
        rows = _run_sql(client, sql)
        if not rows:
            return {}
        row = rows[0]
        row["chain"] = chain.key
        return row
    except Exception as exc:
        logger.warning("Dune wallet fetch failed on %s for %s: %s", chain.key, wallet_address, exc)
        return {}


def fetch_wallet_features(wallet_address: str) -> dict:
    """Wallet behavior across Robinhood hub + Dune-indexed spoke chains."""
    if _use_mock_data():
        from indexer.mock_data import mock_wallet_features

        return mock_wallet_features()

    address = _normalize_wallet(wallet_address)
    per_chain = [fetch_robinhood_wallet_features(wallet_address)]

    try:
        client = _get_client()
        for chain in dune_wallet_chains():
            per_chain.append(_fetch_dune_wallet_for_chain(client, chain, address))
    except Exception as exc:
        logger.warning("Dune wallet aggregation failed for %s: %s", wallet_address, exc)

    return merge_wallet_features(per_chain)


def fetch_aave_features(wallet_address: str) -> dict:
    """Borrow/repayment history: CredFlow hub + Aave on spoke/reputation chains."""
    if _use_mock_data():
        from indexer.mock_data import mock_aave_features

        return mock_aave_features()

    address = _normalize_wallet(wallet_address)
    per_chain = [fetch_credflow_lending_features(wallet_address)]

    blockchains = dune_lending_blockchains()
    if blockchains:
        try:
            client = _get_client()
            sql = _aave_sql(blockchains, address)
            rows = _run_sql(client, sql)
            if rows:
                row = rows[0]
                row["chain"] = "dune_aave"
                per_chain.append(row)
        except Exception as exc:
            logger.warning("Dune Aave aggregation failed for %s: %s", wallet_address, exc)

    return merge_borrow_features(per_chain)
