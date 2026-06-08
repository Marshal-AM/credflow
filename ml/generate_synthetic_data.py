"""Generate synthetic training data for testnet-only CredFlow scoring."""

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
    """Generate labeled synthetic CSV targeting ~12-15% default rate."""
    rng = np.random.default_rng(random_seed)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for _ in range(n_samples):
        wallet_age_days = float(rng.exponential(400))
        tx_count = float(rng.poisson(150))
        unique_contracts = float(rng.poisson(8))
        active_months = float(rng.integers(1, 7))
        days_since_active = float(rng.exponential(14))
        longest_gap = float(rng.exponential(60))
        eth_balance = float(rng.exponential(1.5))

        supply_count = float(rng.poisson(2))
        withdraw_count = float(rng.poisson(1))
        borrow_count = float(rng.poisson(3))
        repay_count = float(rng.binomial(int(max(borrow_count, 1)), 0.85)) if borrow_count else 0.0
        liquidation_count = float(rng.poisson(0.2))
        repay_ratio = repay_count / borrow_count if borrow_count > 0 else 0.5
        avg_blocks_to_repay = float(rng.uniform(100, 50000)) if repay_count else 0.0
        avg_loan_duration_days = float(rng.uniform(1, 60)) if borrow_count else 0.0
        withdraw_before_borrow = float(rng.poisson(0.3))
        net_collateral = max(0.0, supply_count - withdraw_count)
        borrow_diversity = float(rng.poisson(1.5)) if borrow_count else 0.0
        collateral_diversity = float(rng.poisson(2)) if supply_count else 0.0
        partial_repay_count = float(rng.poisson(0.4)) if borrow_count else 0.0
        partial_repay_ratio = partial_repay_count / borrow_count if borrow_count else 0.0

        has_been_liquidated = int(liquidation_count > 0)
        wallet_age_flag = int(wallet_age_days < 7)
        zero_repays_multi = int(borrow_count >= 2 and repay_count == 0)
        burst_flag = int(rng.random() < 0.08)
        aave_only = int(rng.random() < 0.06)
        borrow_transfer_out = int(rng.random() < 0.05)

        risk_signal = (
            -0.004 * wallet_age_days
            - 2.5 * repay_ratio
            + 2.5 * has_been_liquidated
            + 1.5 * wallet_age_flag
            + 1.2 * zero_repays_multi
            + 1.0 * burst_flag
            + 0.8 * aave_only
            + 1.0 * borrow_transfer_out
            + 0.8 * withdraw_before_borrow
            - 0.2 * days_since_active
            - 0.3 * active_months
            - 0.5 * unique_contracts
            + rng.normal(0, 1.0)
        )
        default_prob = float(_sigmoid(risk_signal))

        row = {
            "wallet_age_days": wallet_age_days,
            "tx_count": tx_count,
            "unique_contracts_interacted": unique_contracts,
            "active_months_last_6": active_months,
            "days_since_last_active": days_since_active,
            "longest_inactive_gap_days": longest_gap,
            "eth_balance": eth_balance,
            "aave_supply_count": supply_count,
            "aave_withdraw_count": withdraw_count,
            "aave_borrow_count": borrow_count,
            "aave_repay_count": repay_count,
            "aave_liquidation_count": liquidation_count,
            "repay_ratio": repay_ratio,
            "avg_blocks_to_repay": avg_blocks_to_repay,
            "avg_loan_duration_days": avg_loan_duration_days,
            "collateral_withdraw_before_borrow_count": withdraw_before_borrow,
            "net_collateral_position": net_collateral,
            "borrow_diversity": borrow_diversity,
            "collateral_diversity": collateral_diversity,
            "partial_repay_count": partial_repay_count,
            "partial_repay_ratio": partial_repay_ratio,
            "has_been_liquidated": has_been_liquidated,
            "wallet_age_flag": wallet_age_flag,
            "zero_repays_multiple_borrows_flag": zero_repays_multi,
            "burst_activity_flag": burst_flag,
            "aave_only_wallet_flag": aave_only,
            "borrow_then_transfer_out_flag": borrow_transfer_out,
            "_default_prob": default_prob,
        }
        rows.append(row)

    df = pd.DataFrame(rows)
    # Label top ~13% riskiest wallets as defaulted (stable stratified training set)
    cutoff = df["_default_prob"].quantile(0.87)
    df["defaulted"] = (df["_default_prob"] >= cutoff).astype(int)
    df = df.drop(columns=["_default_prob"])
    df.to_csv(output_path, index=False)
    return output_path


if __name__ == "__main__":
    path = generate_synthetic_training_csv()
    print(f"Wrote {path} ({len(pd.read_csv(path))} rows)")
