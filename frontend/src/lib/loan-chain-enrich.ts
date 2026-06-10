import type { ChainLoanSummary } from "@/lib/loan-server";

export type LzLockKind = "none" | "hub_mirror" | "lz_clear_pending";

export type EnrichedChainLoan = ChainLoanSummary & {
  lzLockKind: LzLockKind;
  hasLocalLoan: boolean;
};

/** Clarify spoke LZ flags: hub borrow mirrors loan_active; hub repay clears via LZ repaid broadcast. */
export function enrichChainSummaries(
  summaries: ChainLoanSummary[]
): EnrichedChainLoan[] {
  const hub = summaries.find((s) => s.chainKey === "hub");
  const hubHasLoan = Boolean(
    hub && (hub.activeLoanId > 0n || hub.loan?.active)
  );

  return summaries.map((s) => {
    const hasLocalLoan = Boolean(
      s.loan?.active || s.activeLoanId > 0n || s.loanActive
    );
    let lzLockKind: LzLockKind = "none";
    let eligibilityReason = s.eligibilityReason;
    let eligible = s.eligible;

    if (s.chainKey !== "hub" && !hasLocalLoan) {
      if (hubHasLoan) {
        // Hub loan locks all spokes — do not rely on per-spoke LZ delivery (Base may lag Arbitrum).
        lzLockKind = "hub_mirror";
        eligibilityReason = s.lzLoanActive
          ? "No loan on this chain. Your Robinhood hub loan locks spoke borrowing via LayerZero until you repay there."
          : "No loan on this chain. Hub loan is active — spoke borrow locked (LayerZero sync may still be in flight to this chain).";
        eligible = false;
      } else if (s.lzLoanActive) {
        // Hub lending is clear; spoke mirror lags until LZ repaid delivers (hub tx ≠ instant spoke clear).
        lzLockKind = "lz_clear_pending";
        eligibilityReason =
          "Hub loan repaid — LayerZero unlock submitted; borrow will wait for spoke delivery (refresh or try borrow).";
      }
    }

    return {
      ...s,
      hasLocalLoan,
      lzLockKind,
      eligibilityReason,
      eligible,
      loanActive: hasLocalLoan,
    };
  });
}
