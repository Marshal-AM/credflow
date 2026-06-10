"""Cross-chain sync — broadcast scores and loan state to spokes."""

from __future__ import annotations

import argparse
import logging
import os

from dotenv import load_dotenv
from web3 import Web3

from agents.base import CredFlowAgent
from agents.groq_brain import review_sync_priority
from agents.state import last_sync_block, save_sync_block

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | sync | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

SYNC_FROM_BLOCK = int(os.environ.get("SYNC_FROM_BLOCK", "0"))
BLOCK_WINDOW = int(os.environ.get("SYNC_BLOCK_WINDOW", "50000"))
LOAN_SYNC_FROM_BLOCK = int(os.environ.get("LOAN_SYNC_FROM_BLOCK", "0"))


def _collect_score_events(agent: CredFlowAgent) -> list[dict]:
    sbt = agent.sbt
    latest = agent.w3.eth.block_number
    stored = last_sync_block()
    from_block = SYNC_FROM_BLOCK or stored or max(0, latest - BLOCK_WINDOW)

    wallets: dict[str, int] = {}

    for event_cls, score_attr in (
        (sbt.events.SBTMinted, "initialScore"),
        (sbt.events.ScoreUpdated, "newScore"),
    ):
        for ev in event_cls.get_logs(from_block=from_block, to_block="latest"):
            wallet = Web3.to_checksum_address(ev.args.wallet)
            wallets[wallet] = int(getattr(ev.args, score_attr))

    return [{"wallet": w, "score": s} for w, s in wallets.items()]


def _hub_loan_active(agent: CredFlowAgent, wallet: str) -> bool:
    """Current hub lending state — do not infer from historical LoanCreated logs."""
    loan_id = agent.lending.functions.activeLoanId(wallet).call()
    return int(loan_id) > 0


def _collect_loan_events(agent: CredFlowAgent) -> tuple[list[str], list[str]]:
    lending = agent.lending
    latest = agent.w3.eth.block_number
    from_block = LOAN_SYNC_FROM_BLOCK or max(0, latest - BLOCK_WINDOW)

    touched: set[str] = set()
    for ev in lending.events.LoanCreated.get_logs(from_block=from_block, to_block="latest"):
        touched.add(Web3.to_checksum_address(ev.args.borrower))
    for ev in lending.events.LoanRepaid.get_logs(from_block=from_block, to_block="latest"):
        touched.add(Web3.to_checksum_address(ev.args.borrower))

    active_wallets: list[str] = []
    repaid_wallets: list[str] = []
    for wallet in sorted(touched):
        if _hub_loan_active(agent, wallet):
            active_wallets.append(wallet)
        else:
            repaid_wallets.append(wallet)

    return active_wallets, repaid_wallets


def run_sync_once(agent: CredFlowAgent | None = None) -> list[dict]:
    agent = agent or CredFlowAgent()
    events = _collect_score_events(agent)
    if not events:
        logger.info("No score events to sync")
    else:
        priority = review_sync_priority(events)
        logger.info("Groq sync notes: %s", priority.notes)

        ordered = events
        if priority.priority_wallets:
            prio_set = {Web3.to_checksum_address(w) for w in priority.priority_wallets}
            ordered = sorted(events, key=lambda e: (e["wallet"] not in prio_set, e["wallet"]))

        results = []
        for item in ordered:
            txs = agent.broadcast_score(item["wallet"], item["score"])
            results.append({**item, "hub_tx_hashes": txs, "type": "score"})
            logger.info("Synced %s score=%s txs=%s", item["wallet"], item["score"], len(txs))

        save_sync_block(agent.w3.eth.block_number)
        return results

    return []


def run_loan_sync_once(agent: CredFlowAgent | None = None) -> list[dict]:
    agent = agent or CredFlowAgent()
    active, repaid = _collect_loan_events(agent)
    results: list[dict] = []

    for wallet in active:
        txs = agent.broadcast_loan_active(wallet)
        results.append({"wallet": wallet, "type": "loan_active", "hub_tx_hashes": txs})
        logger.info("Synced loan active %s txs=%s", wallet, len(txs))

    for wallet in repaid:
        txs = agent.broadcast_repaid(wallet)
        results.append({"wallet": wallet, "type": "repaid", "hub_tx_hashes": txs})
        logger.info("Synced repaid %s txs=%s", wallet, len(txs))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="CredFlow cross-chain score sync")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--loans-only", action="store_true", help="Sync loan active/repaid only")
    parser.add_argument("--scores-only", action="store_true", help="Sync scores only")
    args = parser.parse_args()

    agent = CredFlowAgent()
    results: list[dict] = []

    if not args.loans_only:
        results.extend(run_sync_once(agent))
    if not args.scores_only:
        results.extend(run_loan_sync_once(agent))

    logger.info("Sync complete — %s operations", len(results))


if __name__ == "__main__":
    main()
