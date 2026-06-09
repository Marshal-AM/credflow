"""Groq LLM judgment layer with structured Pydantic outputs."""

from __future__ import annotations

import json
import logging
import os
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

logger = logging.getLogger(__name__)

GROQ_TIMEOUT_SEC = 10


class UnderwritingVerdict(BaseModel):
    action: Literal["approve", "reject", "manual_review"] = "reject"
    reasoning: str = ""
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class MonitorVerdict(BaseModel):
    escalate: bool = False
    severity: Literal["low", "medium", "high", "critical"] = "low"
    reasoning: str = ""
    flag_liquidation: bool = False


class LiquidationVerdict(BaseModel):
    proceed: bool = True
    wallets_to_blacklist: list[str] = Field(default_factory=list)
    reasoning: str = ""


class RateVerdict(BaseModel):
    adjust_bps: int = Field(default=0, ge=-50, le=50)
    direction: Literal["increase", "decrease", "hold"] = "hold"
    reasoning: str = ""


class SyncVerdict(BaseModel):
    priority_wallets: list[str] = Field(default_factory=list)
    notes: str = ""


def _get_llm():
    from langchain_groq import ChatGroq

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set")
    model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    return ChatGroq(
        api_key=api_key,
        model=model,
        temperature=0.1,
        timeout=GROQ_TIMEOUT_SEC,
    )


def _invoke_json(prompt: str, schema: type[BaseModel], fallback: BaseModel) -> BaseModel:
    try:
        llm = _get_llm()
        structured = llm.with_structured_output(schema)
        result = structured.invoke(prompt)
        logger.info("Groq verdict: %s", result.model_dump())
        return result
    except Exception as exc:
        logger.warning("Groq parse failure, using conservative fallback: %s", exc)
        return fallback


def review_underwriting(
    wallet: str,
    cred_score: int,
    sybil_risk: str,
    model_breakdown: dict,
) -> UnderwritingVerdict:
    prompt = f"""You are a credit underwriter for CredFlow DeFi lending.
Review this borderline applicant and respond with JSON only.

Wallet: {wallet}
CredScore: {cred_score}
Sybil risk: {sybil_risk}
Model breakdown: {json.dumps(model_breakdown, default=str)[:4000]}

Hard rules already passed (score >= 500, sybil not high).
Sybil levels low and medium are acceptable — only sybil high is a hard reject.
Decide: approve, reject, or manual_review (manual_review = reject on-chain).
Use manual_review only for genuinely ambiguous score/repayment signals."""
    fallback = UnderwritingVerdict(action="reject", reasoning="Groq unavailable — conservative reject", confidence=0.0)
    return _invoke_json(prompt, UnderwritingVerdict, fallback)


def review_monitor_escalation(
    loan_id: int,
    borrower: str,
    ltv_bps: int,
    max_ltv_bps: int,
    days_to_due: float,
    overdue: bool,
) -> MonitorVerdict:
    prompt = f"""Portfolio monitor for CredFlow loans.
Loan {loan_id}, borrower {borrower}.
Current LTV bps: {ltv_bps}, max LTV bps: {max_ltv_bps}, days to due: {days_to_due:.1f}, overdue: {overdue}.
Health warning threshold is 7500 bps; liquidation at 8500 bps.
Return escalate severity and whether to flag liquidation agent early."""
    fallback = MonitorVerdict(
        escalate=ltv_bps >= 8000 or overdue,
        severity="high" if ltv_bps >= 8000 else "medium",
        reasoning="Groq unavailable — rule-based escalation",
        flag_liquidation=overdue,
    )
    return _invoke_json(prompt, MonitorVerdict, fallback)


def review_liquidation_blacklist(
    defaulter: str,
    linked_wallets: list[dict],
) -> LiquidationVerdict:
    prompt = f"""Liquidation agent reviewing linked wallets for blacklist after default.
Defaulter: {defaulter}
Linked wallets (include confidence): {json.dumps(linked_wallets, default=str)[:6000]}

Rules:
- MUST blacklist all confidence=high wallets
- May add medium-confidence wallets with strong transfer evidence
- Do NOT blacklist low confidence without clear linkage
Return wallets_to_blacklist as checksum addresses."""
    high = [w["wallet"] for w in linked_wallets if w.get("confidence") == "high"]
    fallback = LiquidationVerdict(
        proceed=True,
        wallets_to_blacklist=high,
        reasoning="Groq unavailable — blacklisting high-confidence links only",
    )
    return _invoke_json(prompt, LiquidationVerdict, fallback)


def review_rate_adjustment(
    utilization_bps: int,
    current_base_rate_bps: int,
    total_deposited: int,
    total_borrowed: int,
) -> RateVerdict:
    prompt = f"""Rate optimizer for CredFlow lending pool.
Utilization bps: {utilization_bps}
Current base rate bps: {current_base_rate_bps}
Total deposited: {total_deposited}, total borrowed: {total_borrowed}
Hard rules: util>80% increase, util<50% decrease, clamp base rate [200,2000], adjust within ±50 bps."""
    direction = "hold"
    adjust = 0
    if utilization_bps > 8000:
        direction, adjust = "increase", 25
    elif utilization_bps < 5000:
        direction, adjust = "decrease", 25
    fallback = RateVerdict(adjust_bps=adjust, direction=direction, reasoning="Groq unavailable — rule-based delta")
    return _invoke_json(prompt, RateVerdict, fallback)


def review_sync_priority(wallets: list[dict]) -> SyncVerdict:
    prompt = f"""Cross-chain score sync prioritization.
Wallets with score events: {json.dumps(wallets, default=str)[:4000]}
Order by active loans and large score deltas for logging priority."""
    fallback = SyncVerdict(
        priority_wallets=[w.get("wallet", "") for w in wallets[:10]],
        notes="Groq unavailable — chronological sync",
    )
    return _invoke_json(prompt, SyncVerdict, fallback)
