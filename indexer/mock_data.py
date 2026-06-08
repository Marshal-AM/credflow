"""Deterministic mock payloads for tests and USE_MOCK_DATA=1 dev mode."""

from datetime import datetime, timedelta


def mock_aave_features() -> dict:
    return {
        "total_borrows": 3,
        "on_time_repayments": 3,
        "liquidation_count": 0,
        "avg_loan_duration": 28.0,
        "max_borrow_usd": 5000.0,
    }


def mock_wallet_features() -> dict:
    first_seen = (datetime.utcnow() - timedelta(days=730)).isoformat()
    return {
        "unique_protocols": 5,
        "tx_count": 320,
        "wallet_first_seen": first_seen,
        "wallet_last_active": datetime.utcnow().isoformat(),
    }


def mock_alchemy_state() -> dict:
    return {
        "eth_balance_wei": int(1.5 * 1e18),
        "tx_count": 320,
        "token_balances": {"tokenBalances": []},
        "recent_transactions": [
            {
                "from": "0x0000000000000000000000000000000000000001",
                "to": "0x0000000000000000000000000000000000000002",
                "value": 0.1,
            }
            for _ in range(5)
        ],
    }


def mock_gmx_history() -> dict:
    return {
        "has_gmx_history": True,
        "total_positions": 12,
        "liquidation_count": 0,
        "avg_leverage": 3.5,
        "avg_duration_days": 14.0,
        "total_pnl_usd": 800.0,
        "gmx_sub_score": 71,
    }


def mock_fhenix_attestation() -> dict:
    return {
        "income_above_threshold": True,
        "balance_above_threshold": True,
        "repayment_history_clean": True,
        "account_age_years": 3,
    }
