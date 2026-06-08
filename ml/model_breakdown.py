"""Explain how the ML model turns indexer data into a CredScore."""

from __future__ import annotations

from ml.constants import AAVE_FEATURE_KEYS, FEATURE_COLUMNS, RED_FLAG_FEATURE_KEYS, WALLET_FEATURE_KEYS


def _feature_derivation_notes() -> dict[str, str]:
    return {
        "wallet_age_days": "Days since earliest on-chain activity (hub + spoke RPC)",
        "tx_count": "Lifetime outbound transaction count across all CredFlow chains",
        "unique_contracts_interacted": "Distinct contract addresses the wallet has called",
        "active_months_last_6": "Distinct calendar months with activity in the last 180 days",
        "days_since_last_active": "Days since the wallet's most recent on-chain activity",
        "longest_inactive_gap_days": "Longest gap between consecutive outbound transfers",
        "eth_balance": "Sum of native ETH balances across chains (wei / 1e18)",
        "aave_supply_count": "Aave Supply + CredFlow collateral deposit events",
        "aave_withdraw_count": "Aave Withdraw events",
        "aave_borrow_count": "Aave Borrow + CredFlow loan events",
        "aave_repay_count": "Aave Repay + CredFlow repayment events",
        "aave_liquidation_count": "Liquidation events (hard penalty)",
        "repay_ratio": "aave_repay_count / aave_borrow_count (0.5 if no borrows)",
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

    borrow_count = float(borrow_features.get("aave_borrow_count", borrow_features.get("total_borrows", 0)) or 0)
    repay_ratio = float(borrow_features.get("repay_ratio", features.get("repay_ratio", 0.5)) or 0.5)
    liquidations = float(
        borrow_features.get("aave_liquidation_count", borrow_features.get("liquidation_count", 0)) or 0
    )
    avg_duration = float(borrow_features.get("avg_loan_duration", 0) or 0)

    borrow_parts = {
        "base": 40,
        "repayment_bonus": 20 if repay_ratio >= 0.8 else 0,
        "has_borrows_bonus": 15 if borrow_count > 0 else 0,
        "liquidation_penalty": int(-liquidations * 20),
        "duration_bonus": min(15, int(avg_duration / 4)),
        "withdraw_before_borrow_penalty": -10
        if float(borrow_features.get("collateral_withdraw_before_borrow_count", 0) or 0) > 0
        else 0,
    }

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
            "aave_lending": {k: features.get(k) for k in AAVE_FEATURE_KEYS},
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
                "formula": "40 + repay_ratio(20) + has_borrows(15) - liquidations - withdraw_before_borrow",
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
