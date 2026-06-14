"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BorrowChainPicker } from "./ChainSelect";
import { ChainCredScore } from "./ChainCredScore";
import { LoansPanelShell } from "./LoansPanelShell";
import { useLoansChain } from "./LoansChainContext";
import type { CollateralQuote } from "./loans-types";
import { contractsByChain } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";
import { chainIdByKey } from "@/lib/chains";
import { useEnsureChain } from "@/hooks/use-ensure-chain";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { clientBorrowLoan, formatCollateralEth } from "@/lib/loan-client";
import { COLLATERAL_SYMBOL } from "@/lib/chain-logos";
import { toast } from "@/lib/toast";

type Props = {
  onSuccess: () => void;
};

export function PurchaseLoanPanel({ onSuccess }: Props) {
  const { isConnected } = useAccount();
  const { apiFetch } = useWalletApi();
  const { writeContractAsync } = useWriteContract();
  const { chainOptions, selectedChainKey, setSelectedChainKey, selectedChain, displayCredScore } =
    useLoansChain();
  const [borrowAmount, setBorrowAmount] = useState("0.5");
  const [durationDays, setDurationDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [quote, setQuote] = useState<CollateralQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: pendingHash });

  const chainKey = selectedChainKey as ChainKey | null;
  const cfg = chainKey ? contractsByChain[chainKey] : null;
  const targetChainId = chainKey ? chainIdByKey[chainKey] : undefined;
  const { ensureChain } = useEnsureChain(chainKey ?? "hub");
  const publicClient = usePublicClient({ chainId: targetChainId });

  const loadQuote = useCallback(async () => {
    if (!selectedChain || !selectedChain.eligible || selectedChain.score <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    try {
      const params = new URLSearchParams({
        chain_key: selectedChain.chainKey,
        borrow_amount: borrowAmount,
      });
      const res = await apiFetch(`/api/loans/quote?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setQuoteError(data.error || "Could not compute collateral");
        setQuote(null);
      } else {
        setQuote({
          collateral_eth: data.collateral_eth,
          max_ltv_pct: data.max_ltv_pct,
          eth_usd: data.eth_usd,
        });
        setQuoteError(null);
      }
    } catch {
      setQuoteError("Quote request failed");
      setQuote(null);
    }
  }, [apiFetch, borrowAmount, selectedChain]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  useEffect(() => {
    if (!selectedChain?.eligibilityReason || selectedChain.eligible) return;
    toast.warning(selectedChain.eligibilityReason, `chain-eligibility-${selectedChain.chainKey}`);
  }, [selectedChain]);

  useEffect(() => {
    if (quoteError && selectedChainKey) {
      toast.warning(quoteError, `quote-${selectedChainKey}`);
    }
  }, [quoteError, selectedChainKey]);

  async function handleBorrow() {
    if (!quote || !selectedChain || !chainKey || !cfg || !isConnected || !publicClient) return;
    setBusy(true);
    setStatus("Switching network and signing borrow…");
    try {
      const { txHash, collateralEth } = await clientBorrowLoan({
        chainKey,
        borrowAmount,
        durationDays: Number(durationDays),
        collateralEth: quote.collateral_eth,
        publicClient,
        writeContractAsync,
        ensureChain,
      });
      setPendingHash(txHash);

      const res = await apiFetch("/api/loans/borrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_key: chainKey,
          borrow_amount: borrowAmount,
          duration_days: Number(durationDays),
          tx_hash: txHash,
          collateral_eth: collateralEth,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Borrow confirmation failed");
      toast.success(`Loan opened on ${selectedChain.label}`, `borrow-${chainKey}`);
      setStatus(null);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Borrow failed";
      toast.error(msg, `borrow-error-${chainKey}`);
      setStatus(null);
    } finally {
      setBusy(false);
      setPendingHash(undefined);
    }
  }

  const canBorrow =
    Boolean(selectedChain) &&
    selectedChain!.eligible &&
    Boolean(quote) &&
    !busy &&
    !confirming &&
    isConnected;

  const borrowSymbol = cfg?.borrowSymbol ?? "—";

  return (
    <LoansPanelShell title="Borrow" chainOptions={[]} selectedChainKey={null} onChainChange={() => {}} showChainSelect={false}>
      {!selectedChainKey ? (
        <BorrowChainPicker options={chainOptions} onSelect={setSelectedChainKey} />
      ) : !selectedChain ? (
        <p className="text-sm text-muted-foreground">Loading chain details…</p>
      ) : (
        <>
          <ChainCredScore
            score={displayCredScore ?? 0}
            eligible={selectedChain.eligible}
            chainLabel={selectedChain.label}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="section-label">Borrow amount</span>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                  className="input-field pr-[4.5rem]"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  {borrowSymbol}
                </span>
              </div>
            </label>
            <label className="block">
              <span className="section-label">Duration</span>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="input-field pr-[4.5rem]"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  days
                </span>
              </div>
            </label>
          </div>

          <div className="surface-row px-4 py-4">
            <p className="section-label">Required collateral</p>
            {quote ? (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-2xl font-[650] tabular-nums tracking-tight">
                    {formatCollateralEth(quote.collateral_eth)}
                  </p>
                  <span className="font-mono text-sm text-muted-foreground">{COLLATERAL_SYMBOL}</span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Score tier max LTV {quote.max_ltv_pct}% · {COLLATERAL_SYMBOL} ≈ ${quote.eth_usd}
                </p>
              </>
            ) : quoteError ? (
              <p className="mt-2 text-sm text-destructive">Unable to calculate collateral</p>
            ) : selectedChain.eligible ? (
              <p className="mt-2 text-sm text-muted-foreground">Calculating…</p>
            ) : (
              <p className="mt-2 text-sm text-destructive">
                {selectedChain.eligibilityReason ?? "Not eligible to borrow on this chain"}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canBorrow}
              onClick={() => void handleBorrow()}
              className="btn-primary min-w-[220px] disabled:opacity-50"
            >
              {busy || confirming ? "Borrowing…" : `Borrow on ${selectedChain.label}`}
            </button>
          </div>

          {status && <p className="text-right text-xs text-muted-foreground">{status}</p>}
        </>
      )}
    </LoansPanelShell>
  );
}
