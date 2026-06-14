"""Liquidation agent — liquidate, graph analysis, Groq blacklist filter, LZ broadcast."""

from __future__ import annotations

import argparse
import logging
import os

from dotenv import load_dotenv
from web3 import Web3

from agents.base import CredFlowAgent, SpokeAgent
from agents.groq_brain import review_liquidation_blacklist
from ml.graph_analysis import (
    cap_linked_wallets,
    check_existing_credflow_loans,
    get_transaction_counterparties,
    identify_linked_wallets,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | liquidation | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

GRAPH_DEPTH = int(os.environ.get("GRAPH_ANALYSIS_DEPTH", "1"))
GRAPH_MAX_WALLETS = int(os.environ.get("GRAPH_ANALYSIS_MAX_WALLETS", "10") or "10")
LIQUIDATION_MAX_LINKED_WALLETS = int(
    os.environ.get("LIQUIDATION_MAX_LINKED_WALLETS", "10") or "10"
)
LIQUIDATION_THRESHOLD = int(os.environ.get("LIQUIDATION_LTV_BPS", "8500"))


class LiquidationAgent:
    def __init__(
        self,
        agent: CredFlowAgent | None = None,
        spoke_agent: SpokeAgent | None = None,
    ) -> None:
        self.hub = agent or CredFlowAgent()
        self.spoke = spoke_agent
        self.agent = self.spoke if self.spoke else self.hub

    def attempt_recovery(self, loan_id: int) -> dict:
        """Alias for grace-period recovery attempt before full liquidation."""
        return self.execute_liquidation(loan_id, force_grace=True)

    def execute_liquidation(self, loan_id: int, force_grace: bool = False) -> dict:
        lending = self.agent.lending
        loan = lending.functions.loans(loan_id).call()
        if not loan[8]:
            return {"loan_id": loan_id, "status": "skip", "reason": "Loan not active"}

        borrower = Web3.to_checksum_address(loan[0])
        ltv = lending.functions.getCurrentLTV(loan_id).call()
        threshold = lending.functions.liquidationThreshold().call()

        oracle_crash: dict | None = None
        if ltv < threshold:
            if not force_grace:
                return {
                    "loan_id": loan_id,
                    "status": "skip",
                    "reason": f"LTV {ltv} < threshold {threshold}",
                }
            from agents.test_default import ensure_liquidatable

            hub_agent = self.hub if self.spoke else self.agent
            oracle_crash = ensure_liquidatable(loan_id, hub_agent)
            ltv = lending.functions.getCurrentLTV(loan_id).call()
            logger.info(
                "Oracle crash for liquidation loan %s ltv now %s (threshold %s)",
                loan_id,
                ltv,
                threshold,
            )

        logger.info("Liquidating loan %s borrower %s ltv=%s", loan_id, borrower, ltv)
        liq_tx = self.agent.send_tx(lending.functions.liquidate(loan_id))

        if self.spoke:
            lz_tx = self.hub.broadcast_default(borrower)
            return {
                "loan_id": loan_id,
                "status": "liquidated",
                "borrower": borrower,
                "liquidate_tx": liq_tx,
                "lz_broadcast_tx": lz_tx,
                "chain": self.spoke.chain,
                "oracle_crash": oracle_crash,
            }

        graph = get_transaction_counterparties(
            borrower,
            depth=GRAPH_DEPTH,
            max_wallets=GRAPH_MAX_WALLETS,
        )
        linked = identify_linked_wallets(borrower, graph)
        linked = cap_linked_wallets(linked, LIQUIDATION_MAX_LINKED_WALLETS)
        at_risk = check_existing_credflow_loans(linked, lending_contract=lending)

        verdict = review_liquidation_blacklist(borrower, linked)
        if not verdict.proceed:
            return {
                "loan_id": loan_id,
                "status": "liquidated_no_blacklist",
                "liquidate_tx": liq_tx,
                "groq": verdict.model_dump(),
            }

        high_conf = {Web3.to_checksum_address(w["wallet"]) for w in linked if w.get("confidence") == "high"}
        groq_set = {Web3.to_checksum_address(w) for w in verdict.wallets_to_blacklist if w}
        blacklist_addrs = list(high_conf | groq_set)
        blacklist_addrs = [a for a in blacklist_addrs if a.lower() != borrower.lower()]

        if blacklist_addrs:
            bl_tx = self.hub.send_tx(
                self.hub.sbt.functions.blacklistLinkedWallets(blacklist_addrs, borrower)
            )
        else:
            bl_tx = None

        warning_txs = []
        for risk in at_risk:
            rid = risk.get("loan_id")
            if rid:
                try:
                    tx = self.hub.send_tx(lending.functions.emitHealthWarning(rid))
                    warning_txs.append({"loan_id": rid, "tx": tx})
                except Exception as exc:
                    logger.warning("Health warning failed loan %s: %s", rid, exc)

        lz_tx = self.hub.broadcast_default(borrower)
        for addr in blacklist_addrs:
            self.hub.broadcast_default(addr)

        return {
            "loan_id": loan_id,
            "status": "liquidated",
            "borrower": borrower,
            "liquidate_tx": liq_tx,
            "blacklist_tx": bl_tx,
            "blacklisted": blacklist_addrs,
            "at_risk_loans": at_risk,
            "health_warnings": warning_txs,
            "lz_broadcast_tx": lz_tx,
            "groq": verdict.model_dump(),
            "oracle_crash": oracle_crash,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="CredFlow liquidation agent")
    parser.add_argument("--loan-id", type=int, required=True)
    parser.add_argument("--chain", default="hub", choices=["hub", "arbitrum", "base"])
    parser.add_argument("--force-grace", action="store_true")
    args = parser.parse_args()

    hub = CredFlowAgent()
    spoke = SpokeAgent(args.chain) if args.chain != "hub" else None
    agent = LiquidationAgent(agent=hub, spoke_agent=spoke)
    result = agent.execute_liquidation(args.loan_id, force_grace=args.force_grace)
    logger.info("Result: %s", result)


if __name__ == "__main__":
    main()
