"""Shared ML constants — single source for train and inference."""

FEATURE_COLUMNS = [
    "wallet_age_days",
    "tx_count",
    "protocol_diversity",
    "total_borrows",
    "repayment_rate",
    "defi_liquidation_count",
    "avg_loan_duration_days",
    "eth_balance",
    "gmx_sub_score",
    "gmx_liquidation_count",
    "gmx_avg_leverage",
    "gmx_total_positions",
    "has_gmx_history",
    "fhenix_income_verified",
    "fhenix_balance_verified",
    "fhenix_repayment_clean",
    "fhenix_account_age_years",
]

GMX_FEATURE_KEYS = [
    "gmx_sub_score",
    "gmx_liquidation_count",
    "gmx_avg_leverage",
    "gmx_total_positions",
]

FHENIX_FEATURE_KEYS = [
    "fhenix_income_verified",
    "fhenix_balance_verified",
    "fhenix_repayment_clean",
    "fhenix_account_age_years",
]

WALLET_FEATURE_KEYS = [
    "wallet_age_days",
    "tx_count",
    "protocol_diversity",
    "total_borrows",
    "repayment_rate",
    "defi_liquidation_count",
]

MODEL_PATH = "ml/credflow_model.pkl"
EXPLAINER_PATH = "ml/credflow_explainer.pkl"
SYBIL_MODEL_PATH = "ml/sybil_model.pt"
SYNTHETIC_CSV_PATH = "ml/data/training_synthetic.csv"
