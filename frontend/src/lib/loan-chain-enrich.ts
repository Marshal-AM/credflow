import type { ChainLoanSummary } from "@/lib/loan-server";

export type LzLockKind = "none" | "hub_mirror" | "lz_clear_pending";

export type EnrichedChainLoan = ChainLoanSummary & {
  lzLockKind: LzLockKind;
  hasLocalLoan: boolean;
};

/** Clarify spoke LZ flags: any-chain borrow mirrors loan_active; repay clears via LZ repaid broadcast. */
export function enrichChainSummaries(
  summaries: ChainLoanSummary[]
): EnrichedChainLoan[] {
  const anyChainHasLoan = summaries.some(
    (s) => s.activeLoanId > 0n || s.loan?.active || s.loanActive
  );

  return summaries.map((s) => {
    const hasLocalLoan = Boolean(
      s.loan?.active || s.activeLoanId > 0n || s.loanActive
    );
    let lzLockKind: LzLockKind = "none";
    let eligibilityReason = s.eligibilityReason;
    let eligible = s.eligible;

    if (s.chainKey !== "hub" && !hasLocalLoan) {
      if (anyChainHasLoan) {
        // Any-chain loan locks other spokes — do not rely on per-spoke LZ delivery (Base may lag Arbitrum).
        lzLockKind = "hub_mirror";
        eligibilityReason = s.lzLoanActive
          ? "No loan on this chain. An active loan on another chain locks spoke borrowing via LayerZero until you repay there."
          : "No loan on this chain. Active loan elsewhere — spoke borrow locked (LayerZero sync may still be in flight to this chain).";
        eligible = false;
      } else if (s.lzLoanActive) {
        // All lending clear on-chain; spoke mirror lags until LZ repaid delivers.
        lzLockKind = "lz_clear_pending";
        eligibilityReason =
          "Loan repaid — LayerZero unlock submitted; borrow will wait for spoke delivery (refresh or try borrow).";
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
