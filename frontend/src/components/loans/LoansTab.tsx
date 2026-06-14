"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { PurchaseLoanPanel } from "./PurchaseLoanPanel";
import { ActiveLoansPanel } from "./ActiveLoansPanel";
import { LoanHistoryPanel } from "./LoanHistoryPanel";
import { ChainSelect } from "./ChainSelect";
import { LoansChainProvider, useLoansChain } from "./LoansChainContext";
import type { ChainSummary, LoanEvent } from "./loans-types";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";
import {
  readLoanSubTab,
  STORAGE_KEYS,
  writeStorage,
  type LoanSubTab,
} from "@/lib/ui-persistence";

const SUB_TABS: { id: LoanSubTab; label: string }[] = [
  { id: "purchase", label: "Borrow" },
  { id: "active", label: "Active loans" },
  { id: "history", label: "History" },
];

function LoansTabInner({
  subTab,
  changeSubTab,
  loading,
  onRefresh,
}: {
  subTab: LoanSubTab;
  changeSubTab: (tab: LoanSubTab) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { chainOptions, selectedChainKey, setSelectedChainKey } = useLoansChain();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="tab-pill-bar w-fit">
          {SUB_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => changeSubTab(id)}
              className={`tab-pill-btn ${subTab === id ? "active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {chainOptions.length > 0 && (
            <ChainSelect
              options={chainOptions}
              value={selectedChainKey}
              onChange={setSelectedChainKey}
              placeholder="Select chain"
            />
          )}
          <button type="button" onClick={onRefresh} className="btn-secondary text-sm">
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card-padded">
          <div className="h-64 animate-shimmer rounded-xl" />
        </div>
      ) : (
        <>
          {subTab === "purchase" && <PurchaseLoanPanel onSuccess={onRefresh} />}
          {subTab === "active" && <ActiveLoansPanel onSuccess={onRefresh} />}
          {subTab === "history" && <LoanHistoryPanel />}
        </>
      )}
    </div>
  );
}

export function LoansTab() {
  const { address, isConnected, isConnecting, apiFetch } = useWalletApi();
  const [subTab, setSubTab] = useState<LoanSubTab>("purchase");
  const [chains, setChains] = useState<ChainSummary[]>([]);
  const [displayCredScore, setDisplayCredScore] = useState<number | null>(null);
  const [loanEvents, setLoanEvents] = useState<LoanEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    setSubTab(readLoanSubTab());
  }, []);

  function changeSubTab(next: LoanSubTab) {
    setSubTab(next);
    writeStorage(STORAGE_KEYS.loansSubTab, next);
  }

  const load = useCallback(async () => {
    if (!address) {
      setChains([]);
      setDisplayCredScore(null);
      setLoanEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/loans");
      const data = await res.json();
      setChains(data.chains || []);
      setDisplayCredScore(
        typeof data.displayCredScore === "number" ? data.displayCredScore : null
      );
      setLoanEvents((data.loan_events as LoanEvent[]) || []);
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
    <LoansChainProvider
      chains={chains}
      loanEvents={loanEvents}
      displayCredScore={displayCredScore}
      reload={load}
    >
      <LoansTabInner
        subTab={subTab}
        changeSubTab={changeSubTab}
        loading={loading}
        onRefresh={load}
      />
    </LoansChainProvider>
  );
}
