"use client";

import { useCallback, useEffect, useState } from "react";
import { PurchaseLoanPanel } from "./PurchaseLoanPanel";
import { ActiveLoansPanel } from "./ActiveLoansPanel";
import { RepayLoanPanel } from "./RepayLoanPanel";
import type { ChainSummary } from "./loans-types";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";

type LoanSubTab = "purchase" | "active" | "repay";

const SUB_TABS: { id: LoanSubTab; label: string }[] = [
  { id: "purchase", label: "Borrow" },
  { id: "active", label: "Active loans" },
  { id: "repay", label: "Repay" },
];

export function LoansTab() {
  const { address, isConnected, isConnecting, apiFetch } = useWalletApi();
  const [subTab, setSubTab] = useState<LoanSubTab>("purchase");
  const [chains, setChains] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!address) {
      setChains([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/loans");
      const data = await res.json();
      setChains(data.chains || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [address, apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to borrow and repay loans" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="tab-pill-bar w-fit">
          {SUB_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`tab-pill-btn ${subTab === id ? "active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={load} className="btn-secondary text-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="card-padded">
          <div className="h-64 animate-shimmer rounded-xl" />
        </div>
      ) : (
        <>
          {subTab === "purchase" && (
            <PurchaseLoanPanel chains={chains} onSuccess={load} />
          )}
          {subTab === "active" && <ActiveLoansPanel chains={chains} />}
          {subTab === "repay" && <RepayLoanPanel chains={chains} onSuccess={load} />}
        </>
      )}
    </div>
  );
}
