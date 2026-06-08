"""Generate synthetic training data when Dune bulk export is unavailable."""

import os
from pathlib import Path

import numpy as np
import pandas as pd

from ml.constants import FEATURE_COLUMNS, SYNTHETIC_CSV_PATH


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-x))


def generate_synthetic_training_csv(
    n_samples: int = 5000,
    output_path: str = SYNTHETIC_CSV_PATH,
    random_seed: int = 42,
) -> str:
    """Generate labeled synthetic CSV targeting ~12-15% default rate (threshold 0.82)."""
    rng = np.random.default_rng(random_seed)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for _ in range(n_samples):
        wallet_age_days = float(rng.exponential(400))
        tx_count = float(rng.poisson(150))
        protocol_diversity = float(rng.poisson(4))
        total_borrows = float(rng.poisson(3))
        repayment_rate = float(rng.beta(5, 2)) if total_borrows > 0 else 0.5
        defi_liquidation_count = float(rng.poisson(0.3))
        avg_loan_duration_days = float(rng.uniform(7, 60))
        eth_balance = float(rng.exponential(1.5))
        gmx_sub_score = float(rng.uniform(30, 90))
        gmx_liquidation_count = float(rng.poisson(0.2))
        gmx_avg_leverage = float(rng.uniform(1, 8))
        gmx_total_positions = float(rng.poisson(10))
        has_gmx_history = int(rng.random() > 0.3)
        fhenix_income_verified = int(rng.random() > 0.4)
        fhenix_balance_verified = int(rng.random() > 0.4)
        fhenix_repayment_clean = int(rng.random() > 0.35)
        fhenix_account_age_years = float(rng.uniform(0, 8))

        risk_signal = (
            -0.004 * wallet_age_days
            - 2.5 * repayment_rate
            + 2.0 * defi_liquidation_count
            + 1.8 * gmx_liquidation_count
            - 0.04 * gmx_sub_score
            - 1.2 * fhenix_income_verified
            - 1.2 * fhenix_repayment_clean
            + rng.normal(0, 1.2)
        )
        default_prob = float(_sigmoid(risk_signal * 2.0 + 0.8))

        row = {
            "wallet_age_days": wallet_age_days,
            "tx_count": tx_count,
            "protocol_diversity": protocol_diversity,
            "total_borrows": total_borrows,
            "repayment_rate": repayment_rate,
            "defi_liquidation_count": defi_liquidation_count,
            "avg_loan_duration_days": avg_loan_duration_days,
            "eth_balance": eth_balance,
            "gmx_sub_score": gmx_sub_score,
            "gmx_liquidation_count": gmx_liquidation_count,
            "gmx_avg_leverage": gmx_avg_leverage,
            "gmx_total_positions": gmx_total_positions,
            "has_gmx_history": has_gmx_history,
            "fhenix_income_verified": fhenix_income_verified,
            "fhenix_balance_verified": fhenix_balance_verified,
            "fhenix_repayment_clean": fhenix_repayment_clean,
            "fhenix_account_age_years": fhenix_account_age_years,
            "defaulted": int(default_prob > 0.82),
        }
        rows.append(row)

    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    default_rate = df["defaulted"].mean()
    print(f"Generated {n_samples} rows -> {output_path} (default rate: {default_rate:.1%})")
    return output_path


if __name__ == "__main__":
    generate_synthetic_training_csv()
