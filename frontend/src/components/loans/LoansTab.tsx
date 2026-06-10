"use client";

import { useCallback, useEffect, useState } from "react";
import { PurchaseLoanPanel } from "./PurchaseLoanPanel";
import { ActiveLoansPanel } from "./ActiveLoansPanel";
import { RepayLoanPanel } from "./RepayLoanPanel";
import { LayerZeroSyncPanel } from "./LayerZeroSyncPanel";

type LoanSubTab = "purchase" | "active" | "repay";

type LoanData = {
  loanId: string;
  borrowedAmount: string;
  collateralAmount: string;
  interest: string;
  totalDue: string;
  dueTime: string;
  maxLTV: string;
  interestRate: string;
  active: boolean;
};

type ChainSummary = {
  chainKey: string;
  label: string;
  score: number;
  eligible: boolean;
  eligibilityReason: string | null;
  loanActive: boolean;
  lzLoanActive?: boolean;
  lzLockKind?: "none" | "hub_mirror" | "lz_clear_pending";
  hasLocalLoan?: boolean;
  loan: LoanData | null;
};

const SUB_TABS: { id: LoanSubTab; label: string }[] = [
  { id: "purchase", label: "Purchase loans" },
  { id: "active", label: "Active loans" },
  { id: "repay", label: "Repay" },
];

export function LoansTab() {
  const [subTab, setSubTab] = useState<LoanSubTab>("purchase");
  const [wallet, setWallet] = useState<string>("");
  const [chains, setChains] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/loans");
      const data = await res.json();
      setWallet(data.wallet || "");
      setChains(data.chains || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm text-zinc-600 dark:text-zinc-400">
          {wallet || "Loading wallet…"}
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {SUB_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              subTab === id
                ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading loan state…</p>
      ) : (
        <>
          {subTab === "purchase" && (
            <PurchaseLoanPanel chains={chains} onSuccess={load} />
          )}
          {subTab === "active" && <ActiveLoansPanel chains={chains} />}
          {subTab === "repay" && <RepayLoanPanel chains={chains} onSuccess={load} />}
        </>
      )}

      <LayerZeroSyncPanel />
    </div>
  );
}
