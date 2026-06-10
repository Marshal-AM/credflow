"use client";

import type { ReactNode } from "react";
import type { LzLockKind } from "@/lib/loan-chain-enrich";

type ChainSummary = {
  chainKey: string;
  label: string;
  score: number;
  eligible: boolean;
  eligibilityReason: string | null;
  loanActive: boolean;
  lzLoanActive?: boolean;
  lzLockKind?: LzLockKind;
  hasLocalLoan?: boolean;
};

type Props = {
  chain: ChainSummary;
  children: ReactNode;
};

function StatusBadge({ chain }: { chain: ChainSummary }) {
  if (chain.hasLocalLoan || chain.loanActive) {
    return (
      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
        Loan on chain
      </span>
    );
  }
  if (chain.lzLockKind === "hub_mirror") {
    return (
      <span className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
        Hub loan lock
      </span>
    );
  }
  if (chain.lzLockKind === "lz_clear_pending") {
    return (
      <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-900 dark:bg-violet-900/40 dark:text-violet-200">
        LZ unlock pending
      </span>
    );
  }
  return null;
}

export function ChainLoanCard({ chain, children }: Props) {
  const showNotice =
    Boolean(chain.eligibilityReason) &&
    (chain.lzLockKind === "lz_clear_pending" || !chain.eligible);

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{chain.label}</h3>
          <p className="text-xs text-zinc-500">Score: {chain.score > 0 ? chain.score : "—"}</p>
        </div>
        <StatusBadge chain={chain} />
      </div>
      {showNotice && (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
            chain.lzLockKind === "hub_mirror"
              ? "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
              : chain.lzLockKind === "lz_clear_pending"
                ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100"
                : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          }`}
        >
          {chain.eligibilityReason}
        </p>
      )}
      {children}
    </div>
  );
}
