import type { ChainKey } from "@/lib/chains";
import { triggerClearSpokeLoanActive } from "@/lib/agent-client";
import { readChainLoanSummary } from "@/lib/loan-server";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** If hub has no loan but spoke OApp still has loanActive, broadcast LZ repaid and wait. */
export async function prepareSpokeBorrow(
  chainKey: ChainKey,
  wallet: `0x${string}`
): Promise<void> {
  if (chainKey === "hub") return;

  const spoke = await readChainLoanSummary(chainKey, wallet);
  const hasLocalLoan = spoke.activeLoanId > 0n || spoke.loan?.active;
  if (!spoke.lzLoanActive || hasLocalLoan) return;

  const hub = await readChainLoanSummary("hub", wallet);
  if (hub.activeLoanId > 0n || hub.loan?.active) {
    throw new Error(
      "Cross-chain loan active on hub — repay on Robinhood before borrowing on a spoke"
    );
  }

  const clear = await triggerClearSpokeLoanActive(wallet);
  if (!clear.ok) {
    throw new Error(
      `Stale spoke loan flag could not be cleared (is agents:serve running?): ${clear.error}`
    );
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const again = await readChainLoanSummary(chainKey, wallet);
    if (!again.lzLoanActive) return;
  }

  throw new Error(
    "LayerZero repaid message still pending on spoke — wait 1–2 minutes and try again"
  );
}
