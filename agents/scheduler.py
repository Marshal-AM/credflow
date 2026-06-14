"""CredFlow agent scheduler — replaces OZ Defender cron/sentinels for local and self-hosted runs.

Event-driven agents (underwriter, cross-chain sync on borrow/repay) are triggered by the
Next.js API via api_hook. This daemon runs the scheduled agents:

  - Portfolio Monitor (hub + arbitrum + base)
  - Rate Optimizer (hub)
  - Cross-Chain Sync batch (scores + loan state catch-up)

Usage:
  npm run agents:serve
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from typing import Callable

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.environ.get("AGENT_SCHEDULER_LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)-7s | scheduler | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger(__name__)

MONITOR_INTERVAL = int(os.environ.get("AGENT_MONITOR_INTERVAL_SEC", os.environ.get("MONITOR_POLL_SEC", "300")))
RATES_INTERVAL = int(os.environ.get("AGENT_RATES_INTERVAL_SEC", "3600"))
SYNC_INTERVAL = int(os.environ.get("AGENT_SYNC_INTERVAL_SEC", "3600"))
MONITOR_CHAINS = [c.strip() for c in os.environ.get("AGENT_MONITOR_CHAINS", "hub,arbitrum,base").split(",") if c.strip()]

_running = True


def _stop(_signum: int, _frame: object) -> None:
    global _running
    _running = False
    logger.info("Shutdown requested — finishing current cycle…")


def _run_logged(
    agent_id: str,
    trigger_event: str,
    fn: Callable[[], dict | list | None],
    *,
    wallet_address: str | None = None,
) -> None:
    from agents.run_logger import AgentRunLogger

    run = AgentRunLogger(
        agent_id,
        wallet_address=wallet_address,
        trigger_source="scheduler",
        trigger_event=trigger_event,
    )
    run.start()
    try:
        result = fn()
        summary = "completed"
        txs: list[str] = []
        if isinstance(result, dict):
            summary = result.get("action") or result.get("status") or summary
            for key in ("tx", "liquidate_tx", "blacklist_tx"):
                if result.get(key):
                    txs.append(str(result[key]))
            lz = result.get("lz_broadcast_tx") or result.get("hub_tx_hashes")
            if isinstance(lz, list):
                txs.extend([t.get("tx_hash", t) if isinstance(t, dict) else str(t) for t in lz])
            elif lz:
                txs.append(str(lz))
        elif isinstance(result, list):
            summary = f"{len(result)} items"
            for item in result:
                if isinstance(item, dict):
                    for tx in item.get("hub_tx_hashes") or []:
                        if isinstance(tx, dict) and tx.get("tx_hash"):
                            txs.append(tx["tx_hash"])
                    if item.get("health_warning_tx"):
                        txs.append(str(item["health_warning_tx"]))

        from agents.run_log_details import emit_run_details

        emit_run_details(run, agent_id, result)
        run.log(
            f"Finished {agent_id}: {summary}",
            metadata={"phase": "complete", "summary": summary, "tx_count": len(txs)},
        )
        run.finish(success=True, summary=summary, result={"data": result}, related_tx_hashes=txs)
    except Exception as exc:
        logger.exception("%s failed", agent_id)
        run.log(str(exc), level="error")
        run.finish(success=False, summary=str(exc), error=str(exc))


def _job_monitor() -> list[dict]:
    from agents.portfolio_monitor import run_once

    results: list[dict] = []
    for chain in MONITOR_CHAINS:
        try:
            chain_results = run_once(chain)
            results.extend(chain_results)
            logger.info("Monitor %s: %s active loans checked", chain, len(chain_results))
        except Exception as exc:
            logger.warning("Monitor %s skipped: %s", chain, exc)
            results.append({"chain": chain, "status": "error", "error": str(exc)})
    return results


def _job_rates() -> dict:
    from agents.rate_optimizer import run_once

    return run_once()


def _job_sync() -> list[dict]:
    from agents.crosschain_sync import run_loan_sync_once, run_sync_once

    agent = None
    from agents.base import CredFlowAgent

    agent = CredFlowAgent()
    results: list[dict] = []
    score_results = run_sync_once(agent)
    results.extend(score_results)
    loan_results = run_loan_sync_once(agent)
    results.extend(loan_results)
    logger.info("Sync batch: %s score ops, %s loan ops", len(score_results), len(loan_results))
    return results


def _run_cycle(jobs: list[tuple[str, str, Callable[[], dict | list | None]]]) -> None:
    for agent_id, event, fn in jobs:
        if not _running:
            break
        _run_logged(agent_id, event, fn)


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _stop)

    logger.info("=" * 60)
    logger.info("CredFlow agent scheduler (no OZ Defender)")
    logger.info("  Monitor every %ss on %s", MONITOR_INTERVAL, ", ".join(MONITOR_CHAINS))
    logger.info("  Rate optimizer every %ss", RATES_INTERVAL)
    logger.info("  Cross-chain sync every %ss", SYNC_INTERVAL)
    logger.info("  Event agents: score/mint/borrow/repay via Next.js api_hook")
    logger.info("  Run logs → Supabase agent_runs / agent_log_lines")
    logger.info("=" * 60)

    last_monitor = 0.0
    last_rates = 0.0
    last_sync = 0.0

    # Immediate first pass so Agents tab shows activity without waiting.
    logger.info("Running initial agent pass…")
    _run_logged("portfolio_monitor", "health_check", _job_monitor)
    _run_logged("rate_optimizer", "rate_opt", _job_rates)
    _run_logged("crosschain_sync", "sync_batch", _job_sync)
    last_monitor = last_rates = last_sync = time.monotonic()

    while _running:
        now = time.monotonic()
        if now - last_monitor >= MONITOR_INTERVAL:
            _run_logged("portfolio_monitor", "health_check", _job_monitor)
            last_monitor = now
        if now - last_rates >= RATES_INTERVAL:
            _run_logged("rate_optimizer", "rate_opt", _job_rates)
            last_rates = now
        if now - last_sync >= SYNC_INTERVAL:
            _run_logged("crosschain_sync", "sync_batch", _job_sync)
            last_sync = now
        time.sleep(5)

    logger.info("Agent scheduler stopped.")


if __name__ == "__main__":
    main()
