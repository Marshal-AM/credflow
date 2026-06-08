"""Explain how the ML model turns indexer data into a CredScore."""

from __future__ import annotations

from ml.constants import (
    AGGREGATE_BORROW_FEATURE_KEYS,
    AAVE_FEATURE_KEYS,
    CREDFLOW_FEATURE_KEYS,
    FEATURE_COLUMNS,
    MORPHO_FEATURE_KEYS,
    RED_FLAG_FEATURE_KEYS,
    WALLET_FEATURE_KEYS,
)
from ml.sub_scores import borrow_sub_score_parts


def _feature_derivation_notes() -> dict[str, str]:
    return {
        "wallet_age_days": "Days since earliest on-chain activity (hub + spoke RPC)",
        "tx_count": "Lifetime outbound transaction count across all CredFlow chains",
        "unique_contracts_interacted": "Distinct contract addresses the wallet has called",
        "active_months_last_6": "Distinct calendar months with activity in the last 180 days",
        "days_since_last_active": "Days since the wallet's most recent on-chain activity",
        "longest_inactive_gap_days": "Longest gap between consecutive outbound transfers",
        "eth_balance": "Sum of native ETH balances across chains (wei / 1e18)",
        "credflow_borrow_count": "CredFlow hub LoanCreated events (Robinhood testnet)",
        "credflow_repay_count": "CredFlow hub LoanRepaid events",
        "credflow_liquidation_count": "CredFlow hub LoanLiquidated events",
        "aave_supply_count": "Aave V3 Supply events across spoke testnets",
        "aave_withdraw_count": "Aave V3 Withdraw events",
        "aave_borrow_count": "Aave V3 Borrow events (Arbitrum + Base Sepolia)",
        "aave_repay_count": "Aave V3 Repay events",
        "aave_liquidation_count": "Aave liquidation events",
        "morpho_supply_count": "Morpho Blue SupplyCollateral (Base Sepolia only)",
        "morpho_withdraw_count": "Morpho Blue WithdrawCollateral",
        "morpho_borrow_count": "Morpho Blue Borrow events",
        "morpho_repay_count": "Morpho Blue Repay events",
        "total_borrow_count": "credflow + aave + morpho borrow counts",
        "total_repay_count": "credflow + aave + morpho repay counts",
        "repay_ratio": "total_repay_count / total_borrow_count (0.5 if no borrows)",
        "multi_protocol_borrow_flag": "1 if borrows on 2+ protocols (hub, Aave, Morpho)",
        "avg_blocks_to_repay": "Mean blocks between borrow and matching repay",
        "avg_loan_duration_days": "Mean days from borrow to repay",
        "collateral_withdraw_before_borrow_count": "Withdrawals shortly before a borrow (risky pattern)",
        "net_collateral_position": "supply_count - withdraw_count",
        "borrow_diversity": "Unique assets borrowed",
        "collateral_diversity": "Unique assets supplied",
        "partial_repay_count": "Borrows repaid in multiple transactions before closing",
        "partial_repay_ratio": "partial_repay_count / aave_borrow_count",
        "has_been_liquidated": "1 if any liquidation event (instant red flag)",
        "wallet_age_flag": "1 if wallet_age_days < 7 (sybil / gaming risk)",
        "zero_repays_multiple_borrows_flag": "1 if ≥2 borrows and zero repays",
        "burst_activity_flag": "1 if most activity is clustered in a 7-day window",
        "aave_only_wallet_flag": "1 if wallet only interacted with lending pool contracts",
        "borrow_then_transfer_out_flag": "1 if outbound transfer followed a borrow within 50 blocks",
    }


def build_model_breakdown(
    *,
    features: dict,
    result: dict,
    sybil: dict,
    sub_scores: dict,
    borrow_features: dict,
    approved: bool,
    rejection_reason: str | None,
) -> dict:
    """Full transparency payload for POST /score."""
    shap = result.get("shap_values", {})
    default_prob = float(result.get("default_probability", 0))
    raw_cred = 300 + (1 - default_prob) * 550

    sorted_risk = sorted(shap.items(), key=lambda x: x[1], reverse=True)
    sorted_protective = sorted(shap.items(), key=lambda x: x[1])

    borrow_parts = borrow_sub_score_parts(borrow_features)

    return {
        "model_type": "XGBClassifier",
        "feature_columns": FEATURE_COLUMNS,
        "factors_reference": "docs/factors.md",
        "formula": {
            "step_1_default_probability": "model.predict_proba(feature_vector)[class=1]",
            "step_2_cred_score": "clamp(300 + (1 - default_probability) * 550, 300, 850)",
            "computed": {
                "default_probability": default_prob,
                "raw_cred_score_before_clamp": round(raw_cred, 2),
                "cred_score": result.get("cred_score"),
            },
        },
        "shap_interpretation": (
            "SHAP values show each feature's push toward default (positive SHAP = higher default risk, "
            "lower CredScore). Values are on the model's log-odds scale."
        ),
        "feature_vector": features,
        "feature_derivation": _feature_derivation_notes(),
        "feature_groups": {
            "wallet_behavior": {k: features.get(k) for k in WALLET_FEATURE_KEYS},
            "credflow_hub": {k: features.get(k) for k in CREDFLOW_FEATURE_KEYS},
            "aave_spokes": {k: features.get(k) for k in AAVE_FEATURE_KEYS},
            "morpho_base_sepolia": {k: features.get(k) for k in MORPHO_FEATURE_KEYS},
            "cross_protocol": {k: features.get(k) for k in AGGREGATE_BORROW_FEATURE_KEYS},
            "red_flags": {k: features.get(k) for k in RED_FLAG_FEATURE_KEYS},
        },
        "shap_contributions": shap,
        "top_risk_factors": [
            {"feature": name, "shap": value, "feature_value": features.get(name)}
            for name, value in sorted_risk[:5]
            if value > 0
        ],
        "top_protective_factors": [
            {"feature": name, "shap": value, "feature_value": features.get(name)}
            for name, value in sorted_protective[:5]
            if value < 0
        ],
        "sub_scores": {
            "borrow_sub_score": {
                "value": sub_scores.get("borrow_sub_score"),
                "formula": (
                    "40 + repayment/partial_repay bonus + has_borrows(15) + multi_protocol(5) "
                    "- open_credflow(15) - open_debt(8/proto) - scaled_withdraw(5/count) "
                    "- liquidations - zero_repays - transfer_out"
                ),
                "parts": borrow_parts,
                "borrow_raw": borrow_features,
            },
            "wallet_sub_score": {
                "value": sub_scores.get("wallet_sub_score"),
                "formula": (
                    "30 + age(min 20) + tx(min 15) + contracts(min 15) + active_months(min 10) "
                    "- wallet_age_flag(15) - liquidations*20 + balance(min 10)"
                ),
                "inputs": {k: features.get(k) for k in WALLET_FEATURE_KEYS},
            },
        },
        "sybil_gate": {
            "sybil_risk": sybil.get("sybil_risk"),
            "details": sybil,
            "blocks_approval_when": "sybil_risk == 'high'",
        },
        "approval": {
            "approved": approved,
            "rules": {
                "min_cred_score": 500,
                "max_sybil_risk": "high",
            },
            "rejection_reason": rejection_reason,
        },
    }
