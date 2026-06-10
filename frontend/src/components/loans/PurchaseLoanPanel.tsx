"use client";

import { useCallback, useEffect, useState } from "react";
import { ChainLoanCard } from "./ChainLoanCard";
import { contractsByChain } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";

type ChainSummary = {
  chainKey: string;
  label: string;
  score: number;
  eligible: boolean;
  eligibilityReason: string | null;
  loanActive: boolean;
  lzLockKind?: "none" | "hub_mirror" | "lz_clear_pending";
  hasLocalLoan?: boolean;
};

type CollateralQuote = {
  collateral_eth: string;
  max_ltv_pct: string;
  eth_usd: string;
};

type Props = {
  chains: ChainSummary[];
  onSuccess: () => void;
};

function formatCollateralEth(eth: string): string {
  const n = Number(eth);
  if (!Number.isFinite(n)) return eth;
  if (n >= 0.001) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}

export function PurchaseLoanPanel({ chains, onSuccess }: Props) {
  const [borrowAmount, setBorrowAmount] = useState("0.5");
  const [durationDays, setDurationDays] = useState("30");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, CollateralQuote | null>>({});
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});

  const loadQuotes = useCallback(async () => {
    const nextQuotes: Record<string, CollateralQuote | null> = {};
    const nextErrors: Record<string, string> = {};

    await Promise.all(
      chains.map(async (chain) => {
        if (!chain.eligible || chain.score <= 0) {
          nextQuotes[chain.chainKey] = null;
          return;
        }
        try {
          const params = new URLSearchParams({
            chain_key: chain.chainKey,
            borrow_amount: borrowAmount,
          });
          const res = await fetch(`/api/loans/quote?${params}`);
          const data = await res.json();
          if (!res.ok) {
            nextErrors[chain.chainKey] = data.error || "Could not compute collateral";
            nextQuotes[chain.chainKey] = null;
          } else {
            nextQuotes[chain.chainKey] = {
              collateral_eth: data.collateral_eth,
              max_ltv_pct: data.max_ltv_pct,
              eth_usd: data.eth_usd,
            };
          }
        } catch {
          nextErrors[chain.chainKey] = "Quote request failed";
          nextQuotes[chain.chainKey] = null;
        }
      })
    );

    setQuotes(nextQuotes);
    setQuoteErrors(nextErrors);
  }, [chains, borrowAmount]);

  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes]);

  async function handleBorrow(chainKey: ChainKey) {
    setBusy(chainKey);
    setStatus((s) => ({ ...s, [chainKey]: "Submitting borrow…" }));
    try {
      const res = await fetch("/api/loans/borrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_key: chainKey,
          borrow_amount: borrowAmount,
          duration_days: Number(durationDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Borrow failed");
      const lz = data.lz_sync?.ok ? " + LZ sync started" : "";
      const coll = data.collateral_eth
        ? ` · ${formatCollateralEth(data.collateral_eth)} WETH posted`
        : "";
      setStatus((s) => ({
        ...s,
        [chainKey]: `Loan tx: ${data.loan_tx}${coll}${lz}`,
      }));
      onSuccess();
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [chainKey]: err instanceof Error ? err.message : "Borrow failed",
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {chains.map((chain) => {
        const cfg = contractsByChain[chain.chainKey as ChainKey];
        const quote = quotes[chain.chainKey];
        const quoteError = quoteErrors[chain.chainKey];
        return (
          <ChainLoanCard key={chain.chainKey} chain={chain}>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs text-zinc-500">Borrow ({cfg.borrowSymbol})</span>
                <input
                  type="text"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Duration (days)</span>
                <input
                  type="text"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/50">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Required WETH collateral
                </p>
                {quote ? (
                  <>
                    <p className="mt-1 text-base font-semibold tabular-nums">
                      {formatCollateralEth(quote.collateral_eth)} ETH
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Score tier max LTV {quote.max_ltv_pct}% · ETH ≈ ${quote.eth_usd}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Computed from borrow amount and your on-chain score — not editable.
                    </p>
                  </>
                ) : quoteError ? (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{quoteError}</p>
                ) : chain.eligible ? (
                  <p className="mt-1 text-xs text-zinc-500">Calculating…</p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">—</p>
                )}
              </div>
              <button
                type="button"
                disabled={
                  !chain.eligible || busy === chain.chainKey || !quote
                }
                onClick={() => handleBorrow(chain.chainKey as ChainKey)}
                className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === chain.chainKey ? "Borrowing…" : `Borrow on ${chain.label}`}
              </button>
              {status[chain.chainKey] && (
                <p className="text-xs break-all text-zinc-600 dark:text-zinc-400">
                  {status[chain.chainKey]}
                </p>
              )}
            </div>
          </ChainLoanCard>
        );
      })}
    </div>
  );
}
