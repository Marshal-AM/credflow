"""Generate synthetic training data aligned with multi-protocol inference."""

from pathlib import Path

import numpy as np
import pandas as pd

from ml.constants import FEATURE_COLUMNS, SYNTHETIC_CSV_PATH


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-x))


def _protocol_borrows(rng: np.random.Generator, active: bool, lam: float) -> tuple[float, float, float]:
    if not active:
        return 0.0, 0.0, 0.0
    borrow = float(rng.poisson(lam))
    if borrow == 0:
        return 0.0, 0.0, 0.0
    repay = float(rng.binomial(int(borrow), 0.85))
    liquidation = float(rng.poisson(0.15)) if borrow > 0 else 0.0
    return borrow, repay, liquidation


def generate_synthetic_training_csv(
    n_samples: int = 5000,
    output_path: str = SYNTHETIC_CSV_PATH,
    random_seed: int = 42,
) -> str:
    """
    Generate labeled synthetic CSV targeting ~12-15% default rate.

    Mirrors inference sources:
    - CredFlow hub lending (Robinhood testnet)
    - Aave V3 spokes (Arbitrum + Base Sepolia)
    - Morpho Blue (Base Sepolia only)
    """
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

        uses_credflow = bool(rng.random() < 0.28)
        uses_aave = bool(rng.random() < 0.52)
        uses_morpho = bool(rng.random() < 0.22)

        credflow_borrow, credflow_repay, credflow_liquidation = _protocol_borrows(rng, uses_credflow, 1.5)
        aave_borrow, aave_repay, aave_liquidation = _protocol_borrows(rng, uses_aave, 2.5)
        morpho_borrow, morpho_repay, _morpho_liq = _protocol_borrows(rng, uses_morpho, 1.2)

        aave_supply = float(rng.poisson(2)) if uses_aave and aave_borrow else 0.0
        aave_withdraw = float(rng.poisson(1)) if aave_supply else 0.0
        morpho_supply = float(rng.poisson(1.5)) if uses_morpho and morpho_borrow else 0.0
        morpho_withdraw = float(rng.poisson(0.8)) if morpho_supply else 0.0

        total_borrow = credflow_borrow + aave_borrow + morpho_borrow
        total_repay = credflow_repay + aave_repay + morpho_repay
        repay_ratio = total_repay / total_borrow if total_borrow > 0 else 0.5

        protocols_with_borrows = sum(
            1 for count in (credflow_borrow, aave_borrow, morpho_borrow) if count > 0
        )
        multi_protocol_borrow_flag = int(protocols_with_borrows >= 2)

        avg_blocks_to_repay = float(rng.uniform(100, 50000)) if total_repay else 0.0
        avg_loan_duration_days = float(rng.uniform(1, 60)) if total_borrow else 0.0
        withdraw_before_borrow = float(rng.poisson(0.3)) if total_borrow else 0.0
        net_collateral = max(0.0, aave_supply + morpho_supply - aave_withdraw - morpho_withdraw)
        borrow_diversity = float(rng.poisson(1.5)) if total_borrow else 0.0
        collateral_diversity = float(rng.poisson(2)) if (aave_supply + morpho_supply) else 0.0
        partial_repay_count = float(rng.poisson(0.4)) if total_borrow else 0.0
        partial_repay_ratio = partial_repay_count / total_borrow if total_borrow else 0.0

        total_liquidations = credflow_liquidation + aave_liquidation
        has_been_liquidated = int(total_liquidations > 0)
        wallet_age_flag = int(wallet_age_days < 7)
        zero_repays_multi = int(total_borrow >= 2 and total_repay == 0)
        burst_flag = int(rng.random() < 0.08)
        lending_only = int(
            rng.random() < 0.06
            and unique_contracts <= 3
            and (uses_aave or uses_morpho)
            and not uses_credflow
        )
        borrow_transfer_out = int(rng.random() < 0.05)

        risk_signal = (
            -0.004 * wallet_age_days
            - 2.5 * repay_ratio
            + 2.5 * has_been_liquidated
            + 1.5 * wallet_age_flag
            + 1.2 * zero_repays_multi
            + 1.0 * burst_flag
            + 0.8 * lending_only
            + 1.0 * borrow_transfer_out
            + 0.8 * withdraw_before_borrow
            - 0.15 * multi_protocol_borrow_flag
            - 0.2 * days_since_active
            - 0.3 * active_months
            - 0.5 * unique_contracts
            + 0.3 * (morpho_borrow > 0 and aave_borrow == 0 and credflow_borrow == 0)
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
            "credflow_borrow_count": credflow_borrow,
            "credflow_repay_count": credflow_repay,
            "credflow_liquidation_count": credflow_liquidation,
            "aave_supply_count": aave_supply,
            "aave_withdraw_count": aave_withdraw,
            "aave_borrow_count": aave_borrow,
            "aave_repay_count": aave_repay,
            "aave_liquidation_count": aave_liquidation,
            "morpho_supply_count": morpho_supply,
            "morpho_withdraw_count": morpho_withdraw,
            "morpho_borrow_count": morpho_borrow,
            "morpho_repay_count": morpho_repay,
            "total_borrow_count": total_borrow,
            "total_repay_count": total_repay,
            "repay_ratio": repay_ratio,
            "avg_blocks_to_repay": avg_blocks_to_repay,
            "avg_loan_duration_days": avg_loan_duration_days,
            "collateral_withdraw_before_borrow_count": withdraw_before_borrow,
            "net_collateral_position": net_collateral,
            "borrow_diversity": borrow_diversity,
            "collateral_diversity": collateral_diversity,
            "partial_repay_count": partial_repay_count,
            "partial_repay_ratio": partial_repay_ratio,
            "multi_protocol_borrow_flag": multi_protocol_borrow_flag,
            "has_been_liquidated": has_been_liquidated,
            "wallet_age_flag": wallet_age_flag,
            "zero_repays_multiple_borrows_flag": zero_repays_multi,
            "burst_activity_flag": burst_flag,
            "aave_only_wallet_flag": lending_only,
            "borrow_then_transfer_out_flag": borrow_transfer_out,
            "_default_prob": default_prob,
        }
        rows.append(row)

    df = pd.DataFrame(rows)
    cutoff = df["_default_prob"].quantile(0.87)
    df["defaulted"] = (df["_default_prob"] >= cutoff).astype(int)
    df = df.drop(columns=["_default_prob"])

    for col in FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = 0

    df = df[FEATURE_COLUMNS + ["defaulted"]]
    df.to_csv(output_path, index=False)
    return output_path


if __name__ == "__main__":
    path = generate_synthetic_training_csv()
    print(f"Wrote {path} ({len(pd.read_csv(path))} rows)")
