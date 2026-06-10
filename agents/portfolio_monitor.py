"""Portfolio monitor — LTV polling, health warnings, grace state."""

from __future__ import annotations

import argparse
import logging
import os
import time
from typing import Union

from dotenv import load_dotenv
from web3 import Web3

from agents.base import CredFlowAgent, SpokeAgent
from agents.groq_brain import review_monitor_escalation
from agents.state import (
    clear_grace,
    grace_expired,
    record_warning,
    should_emit_warning,
    start_grace,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | monitor | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

HEALTH_LTV_BPS = int(os.environ.get("MONITOR_HEALTH_LTV_BPS", "7500"))
LIQUIDATION_LTV_BPS = int(os.environ.get("MONITOR_LIQUIDATION_LTV_BPS", "8500"))
MONITOR_FROM_BLOCK = int(os.environ.get("MONITOR_FROM_BLOCK", "0"))
BLOCK_WINDOW = int(os.environ.get("MONITOR_BLOCK_WINDOW", "50000"))
POLL_INTERVAL = int(os.environ.get("MONITOR_POLL_SEC", "300"))


def _get_agent(chain: str) -> Union[CredFlowAgent, SpokeAgent]:
    chain = chain.lower()
    if chain == "hub":
        return CredFlowAgent()
    if chain == "base":
        rpc = os.environ.get("MONITOR_RPC_BASE")
        if rpc:
            return SpokeAgent("base", rpc_url=rpc)
    return SpokeAgent(chain)


def _scan_active_loans(agent: Union[CredFlowAgent, SpokeAgent]) -> list[int]:
    lending = agent.lending
    try:
        counter = int(lending.functions.loanCounter().call())
    except Exception:
        latest = agent.w3.eth.block_number
        from_block = MONITOR_FROM_BLOCK or max(0, latest - BLOCK_WINDOW)
        events = lending.events.LoanCreated.get_logs(from_block=from_block, to_block="latest")
        loan_ids = {e.args.loanId for e in events}
        active: list[int] = []
        for loan_id in sorted(loan_ids):
            loan = lending.functions.loans(loan_id).call()
            if loan[8]:
                active.append(loan_id)
        return active

    active: list[int] = []
    for loan_id in range(1, counter + 1):
        loan = lending.functions.loans(loan_id).call()
        if loan[8]:
            active.append(loan_id)
    return active


def _monitor_loan(agent: Union[CredFlowAgent, SpokeAgent], loan_id: int, chain: str) -> dict:
    loan = agent.lending.functions.loans(loan_id).call()
    borrower = loan[0]
    due_time = loan[6]
    max_ltv = loan[7]
    now = int(time.time())
    overdue = now > due_time

    ltv = agent.lending.functions.getCurrentLTV(loan_id).call()
    days_to_due = (due_time - now) / 86400.0

    result: dict = {
        "chain": chain,
        "loan_id": loan_id,
        "borrower": borrower,
        "ltv_bps": ltv,
        "overdue": overdue,
    }

    if overdue:
        start_grace(loan_id)
        result["grace"] = "started"

    verdict = review_monitor_escalation(loan_id, borrower, ltv, max_ltv, days_to_due, overdue)
    result["groq"] = verdict.model_dump()

    if ltv >= HEALTH_LTV_BPS and should_emit_warning(loan_id, ltv):
        tx = agent.send_tx(agent.lending.functions.emitHealthWarning(loan_id))
        record_warning(loan_id, ltv)
        result["health_warning_tx"] = tx
        logger.warning("Health warning emitted chain=%s loan=%s ltv=%s", chain, loan_id, ltv)

    if grace_expired(loan_id) or (ltv >= LIQUIDATION_LTV_BPS and verdict.flag_liquidation):
        from agents.liquidation_agent import LiquidationAgent

        hub_agent = agent if isinstance(agent, CredFlowAgent) else CredFlowAgent()
        liq = LiquidationAgent(agent=hub_agent, spoke_agent=agent if chain != "hub" else None)
        liq_result = liq.execute_liquidation(loan_id, force_grace=grace_expired(loan_id))
        result["liquidation"] = liq_result
        if liq_result.get("status") == "liquidated":
            clear_grace(loan_id)

    return result


def run_once(chain: str = "hub", agent: Union[CredFlowAgent, SpokeAgent, None] = None) -> list[dict]:
    agent = agent or _get_agent(chain)
    loans = _scan_active_loans(agent)
    logger.info("Monitoring %s active loans on %s", len(loans), chain)
    return [_monitor_loan(agent, lid, chain) for lid in loans]


def main() -> None:
    parser = argparse.ArgumentParser(description="CredFlow portfolio monitor")
    parser.add_argument("--chain", default="hub", choices=["hub", "arbitrum", "base"])
    parser.add_argument("--once", action="store_true", help="Run one scan and exit")
    parser.add_argument("--daemon", action="store_true", help="Poll continuously")
    args = parser.parse_args()

    agent = _get_agent(args.chain)

    if args.daemon:
        while True:
            for r in run_once(args.chain, agent):
                logger.info("Loan scan: %s", r)
            time.sleep(POLL_INTERVAL)
    else:
        for r in run_once(args.chain, agent):
            logger.info("Loan scan: %s", r)


if __name__ == "__main__":
    main()
