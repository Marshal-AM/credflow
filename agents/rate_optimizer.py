"""Rate optimizer — pool utilization + Groq bps adjustment."""

from __future__ import annotations

import argparse
import logging

from dotenv import load_dotenv

from agents.base import CredFlowAgent
from agents.groq_brain import review_rate_adjustment

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | rates | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

MIN_BASE_RATE = 200
MAX_BASE_RATE = 2000


def run_once(agent: CredFlowAgent | None = None) -> dict:
    agent = agent or CredFlowAgent()

    util_fn = agent.pool.functions.utilizationRate()
    utilization = util_fn.call()
    total_dep = agent.pool.functions.totalDeposited().call()
    total_borrow = agent.pool.functions.totalBorrowed().call()
    current_rate = agent.lending.functions.baseRate().call()

    util_bps = int(utilization)

    verdict = review_rate_adjustment(util_bps, int(current_rate), int(total_dep), int(total_borrow))

    new_rate = int(current_rate)
    if verdict.direction == "increase":
        new_rate += verdict.adjust_bps
    elif verdict.direction == "decrease":
        new_rate -= verdict.adjust_bps

    # Hard rules
    if util_bps > 8000:
        new_rate = max(new_rate, int(current_rate) + 10)
    elif util_bps < 5000:
        new_rate = min(new_rate, int(current_rate) - 10)

    new_rate = max(MIN_BASE_RATE, min(MAX_BASE_RATE, new_rate))

    result = {
        "utilization_bps": util_bps,
        "current_base_rate": int(current_rate),
        "proposed_base_rate": new_rate,
        "groq": verdict.model_dump(),
    }

    if new_rate == current_rate:
        result["action"] = "no_change"
        logger.info("Base rate unchanged at %s bps", current_rate)
        return result

    tx = agent.send_tx(agent.lending.functions.setBaseRate(new_rate))
    result["action"] = "updated"
    result["tx"] = tx
    logger.info("Base rate %s → %s bps (tx %s)", current_rate, new_rate, tx)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="CredFlow rate optimizer")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logger.info("Rate run: %s", run_once())


if __name__ == "__main__":
    main()
