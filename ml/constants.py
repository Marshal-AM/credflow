"""Shared ML constants — single source for train and inference."""

# Aligned with docs/factors.md + multi-protocol inference (hub, Aave spokes, Morpho Base)
FEATURE_COLUMNS = [
    # Wallet-level
    "wallet_age_days",
    "tx_count",
    "unique_contracts_interacted",
    "active_months_last_6",
    "days_since_last_active",
    "longest_inactive_gap_days",
    "eth_balance",
    # CredFlow hub (Robinhood testnet)
    "credflow_borrow_count",
    "credflow_repay_count",
    "credflow_liquidation_count",
    # Aave V3 spokes (Arbitrum + Base Sepolia)
    "aave_supply_count",
    "aave_withdraw_count",
    "aave_borrow_count",
    "aave_repay_count",
    "aave_liquidation_count",
    # Morpho Blue (Base Sepolia only)
    "morpho_supply_count",
    "morpho_withdraw_count",
    "morpho_borrow_count",
    "morpho_repay_count",
    # Cross-protocol derived behaviour
    "total_borrow_count",
    "total_repay_count",
    "repay_ratio",
    "avg_blocks_to_repay",
    "avg_loan_duration_days",
    "collateral_withdraw_before_borrow_count",
    "net_collateral_position",
    "borrow_diversity",
    "collateral_diversity",
    "partial_repay_count",
    "partial_repay_ratio",
    "multi_protocol_borrow_flag",
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

CREDFLOW_FEATURE_KEYS = [
    "credflow_borrow_count",
    "credflow_repay_count",
    "credflow_liquidation_count",
]

AAVE_FEATURE_KEYS = [
    "aave_supply_count",
    "aave_withdraw_count",
    "aave_borrow_count",
    "aave_repay_count",
    "aave_liquidation_count",
]

MORPHO_FEATURE_KEYS = [
    "morpho_supply_count",
    "morpho_withdraw_count",
    "morpho_borrow_count",
    "morpho_repay_count",
]

AGGREGATE_BORROW_FEATURE_KEYS = [
    "total_borrow_count",
    "total_repay_count",
    "repay_ratio",
    "avg_blocks_to_repay",
    "avg_loan_duration_days",
    "collateral_withdraw_before_borrow_count",
    "net_collateral_position",
    "borrow_diversity",
    "collateral_diversity",
    "partial_repay_count",
    "partial_repay_ratio",
    "multi_protocol_borrow_flag",
]

BORROW_FEATURE_KEYS = (
    CREDFLOW_FEATURE_KEYS
    + AAVE_FEATURE_KEYS
    + MORPHO_FEATURE_KEYS
    + AGGREGATE_BORROW_FEATURE_KEYS
)

RED_FLAG_FEATURE_KEYS = [
    "has_been_liquidated",
    "wallet_age_flag",
    "zero_repays_multiple_borrows_flag",
    "burst_activity_flag",
    "aave_only_wallet_flag",
    "borrow_then_transfer_out_flag",
]

MODEL_PATH = "ml/credflow_model.pkl"
EXPLAINER_PATH = "ml/credflow_explainer.pkl"
SYBIL_MODEL_PATH = "ml/sybil_model.pt"
SYNTHETIC_CSV_PATH = "ml/data/training_synthetic.csv"
