"""Deterministic mock payloads for tests and USE_MOCK_DATA=1 dev mode."""

from datetime import datetime, timedelta


def mock_borrow_features() -> dict:
    return {
        "aave_supply_count": 4,
        "aave_withdraw_count": 1,
        "aave_borrow_count": 3,
        "aave_repay_count": 3,
        "aave_liquidation_count": 0,
        "repay_ratio": 1.0,
        "avg_blocks_to_repay": 1200.0,
        "avg_loan_duration": 28.0,
        "collateral_withdraw_before_borrow_count": 0,
        "net_collateral_position": 3,
        "borrow_diversity": 2,
        "collateral_diversity": 2,
        "partial_repay_count": 0,
        "partial_repay_ratio": 0.0,
        "has_been_liquidated": 0,
        "zero_repays_multiple_borrows_flag": 0,
        "borrow_then_transfer_out_count": 0,
        "borrow_then_transfer_out_flag": 0,
        "total_borrows": 3,
        "on_time_repayments": 3,
        "liquidation_count": 0,
        "max_borrow_usd": 3.0,
        "activity_rows": [],
    }


def mock_wallet_features() -> dict:
    first_seen = (datetime.utcnow() - timedelta(days=730)).isoformat()
    last_active = datetime.utcnow().isoformat()
    timestamps = [
        (datetime.utcnow() - timedelta(days=d)).timestamp()
        for d in (1, 15, 45, 90, 120, 200, 400, 600)
    ]
    return {
        "unique_protocols": 12,
        "unique_contracts_interacted": 12,
        "unique_contract_addresses": [f"0x{'a' * 38}{i:02d}" for i in range(12)],
        "tx_count": 320,
        "active_months_last_6": 5,
        "days_since_last_active": 1.0,
        "longest_inactive_gap_days": 45.0,
        "burst_activity_flag": 0,
        "aave_only_wallet_flag": 0,
        "transfer_timestamps": timestamps,
        "wallet_first_seen": first_seen,
        "wallet_last_active": last_active,
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
                "category": "erc20",
                "blockNum": "0x100",
            }
            for _ in range(5)
        ],
    }
