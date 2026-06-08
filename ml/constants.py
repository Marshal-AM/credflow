"""Shared ML constants — single source for train and inference."""

# Aligned with docs/factors.md (counts, ratios, time patterns — no testnet USD)
FEATURE_COLUMNS = [
    # Wallet-level
    "wallet_age_days",
    "tx_count",
    "unique_contracts_interacted",
    "active_months_last_6",
    "days_since_last_active",
    "longest_inactive_gap_days",
    "eth_balance",
    # Aave / lending activity
    "aave_supply_count",
    "aave_withdraw_count",
    "aave_borrow_count",
    "aave_repay_count",
    "aave_liquidation_count",
    # Derived behaviour
    "repay_ratio",
    "avg_blocks_to_repay",
    "avg_loan_duration_days",
    "collateral_withdraw_before_borrow_count",
    "net_collateral_position",
    "borrow_diversity",
    "collateral_diversity",
    "partial_repay_count",
    "partial_repay_ratio",
    # Red-flag booleans (0/1)
    "has_been_liquidated",
    "wallet_age_flag",
    "zero_repays_multiple_borrows_flag",
    "burst_activity_flag",
    "aave_only_wallet_flag",
    "borrow_then_transfer_out_flag",
]

WALLET_FEATURE_KEYS = [
    "wallet_age_days",
    "tx_count",
    "unique_contracts_interacted",
    "active_months_last_6",
    "days_since_last_active",
    "longest_inactive_gap_days",
    "eth_balance",
    "wallet_age_flag",
    "burst_activity_flag",
    "aave_only_wallet_flag",
]

AAVE_FEATURE_KEYS = [
    "aave_supply_count",
    "aave_withdraw_count",
    "aave_borrow_count",
    "aave_repay_count",
    "aave_liquidation_count",
    "repay_ratio",
    "avg_blocks_to_repay",
    "avg_loan_duration_days",
    "collateral_withdraw_before_borrow_count",
    "net_collateral_position",
    "borrow_diversity",
    "collateral_diversity",
    "partial_repay_count",
    "partial_repay_ratio",
    "has_been_liquidated",
    "zero_repays_multiple_borrows_flag",
    "borrow_then_transfer_out_flag",
]

RED_FLAG_FEATURE_KEYS = [
    "has_been_liquidated",
    "wallet_age_flag",
    "zero_repays_multiple_borrows_flag",
    "burst_activity_flag",
    "aave_only_wallet_flag",
    "borrow_then_transfer_out_flag",
]

BORROW_FEATURE_KEYS = AAVE_FEATURE_KEYS

MODEL_PATH = "ml/credflow_model.pkl"
EXPLAINER_PATH = "ml/credflow_explainer.pkl"
SYBIL_MODEL_PATH = "ml/sybil_model.pt"
SYNTHETIC_CSV_PATH = "ml/data/training_synthetic.csv"
