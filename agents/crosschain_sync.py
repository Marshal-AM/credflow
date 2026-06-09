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


def _collect_loan_events(agent: CredFlowAgent) -> tuple[list[str], list[str]]:
    lending = agent.lending
    latest = agent.w3.eth.block_number
    from_block = LOAN_SYNC_FROM_BLOCK or max(0, latest - BLOCK_WINDOW)

    active_wallets: list[str] = []
    repaid_wallets: list[str] = []

    for ev in lending.events.LoanCreated.get_logs(from_block=from_block, to_block="latest"):
        active_wallets.append(Web3.to_checksum_address(ev.args.borrower))

    for ev in lending.events.LoanRepaid.get_logs(from_block=from_block, to_block="latest"):
        repaid_wallets.append(Web3.to_checksum_address(ev.args.borrower))

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
            tx = agent.broadcast_score(item["wallet"], item["score"])
            results.append({**item, "tx": tx, "type": "score"})
            logger.info("Synced %s score=%s tx=%s", item["wallet"], item["score"], tx)

        save_sync_block(agent.w3.eth.block_number)
        return results

    return []


def run_loan_sync_once(agent: CredFlowAgent | None = None) -> list[dict]:
    agent = agent or CredFlowAgent()
    active, repaid = _collect_loan_events(agent)
    results: list[dict] = []

    for wallet in active:
        tx = agent.broadcast_loan_active(wallet)
        results.append({"wallet": wallet, "type": "loan_active", "tx": tx})
        logger.info("Synced loan active %s tx=%s", wallet, tx)

    for wallet in repaid:
        tx = agent.broadcast_repaid(wallet)
        results.append({"wallet": wallet, "type": "repaid", "tx": tx})
        logger.info("Synced repaid %s tx=%s", wallet, tx)

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
