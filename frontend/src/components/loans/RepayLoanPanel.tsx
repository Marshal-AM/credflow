"use client";

import { useState } from "react";
import { ChainLoanCard } from "./ChainLoanCard";
import { contractsByChain } from "@/lib/contracts";
import { txExplorerUrl, type ChainKey } from "@/lib/chains";

type LoanData = {
  totalDue: string;
  active: boolean;
};

type ChainSummary = {
  chainKey: string;
  label: string;
  score: number;
  eligible: boolean;
  eligibilityReason: string | null;
  loanActive: boolean;
  lzLockKind?: "none" | "hub_mirror" | "lz_clear_pending";
  hasLocalLoan?: boolean;
  loan: LoanData | null;
};

type RepayOutcome = {
  repay_tx?: string;
  collateral_returned_eth?: string;
  total_repaid?: string;
  borrow_symbol?: string;
  receipt?: { blockNumber: string; status: string; gasUsed: string };
  old_score?: number | null;
  new_score?: number | null;
  score_delta?: number | null;
  errors?: string[];
  underwrite?: { ok: boolean; data?: { tx?: string; onchain?: string; run_id?: string } };
  lz_sync?: { ok: boolean; data?: { hub_tx_hashes?: { tx_hash: string; chain_key: string }[] } };
};

type Props = {
  chains: ChainSummary[];
  onSuccess: () => void;
};

function formatToken(amount: string, decimals = 6): string {
  return (Number(amount) / 10 ** decimals).toFixed(4);
}

export function RepayLoanPanel({ chains, onSuccess }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, RepayOutcome>>({});

  async function handleRepay(chainKey: ChainKey) {
    setBusy(chainKey);
    setStatus((s) => ({ ...s, [chainKey]: "Repaying…" }));
    try {
      const res = await fetch("/api/loans/repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain_key: chainKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Repay failed");
      setOutcomes((o) => ({
        ...o,
        [chainKey]: {
          repay_tx: data.repay_tx,
          collateral_returned_eth: data.collateral_returned_eth,
          total_repaid: data.total_repaid,
          borrow_symbol: data.borrow_symbol,
          receipt: data.receipt,
          old_score: data.old_score,
          new_score: data.new_score,
          score_delta: data.score_delta,
          errors: data.errors,
          underwrite: data.underwrite,
          lz_sync: data.lz_sync,
        },
      }));
      const delta =
        typeof data.score_delta === "number"
          ? data.score_delta >= 0
            ? `+${data.score_delta}`
            : String(data.score_delta)
          : null;
      const scoreLine =
        data.old_score != null && data.new_score != null
          ? `Score ${data.old_score} → ${data.new_score}${delta ? ` (${delta})` : ""}`
          : data.new_score != null
            ? `New score: ${data.new_score}`
            : null;
      const collateralLine =
        data.collateral_returned_eth != null
          ? `Collateral returned: ${Number(data.collateral_returned_eth).toFixed(6)} WETH`
          : null;
      const repaidLine =
        data.total_repaid != null && data.borrow_symbol
          ? `Repaid: ${data.total_repaid} ${data.borrow_symbol}`
          : null;
      setStatus((s) => ({
        ...s,
        [chainKey]: [
          collateralLine,
          repaidLine,
          scoreLine,
          data.errors?.length ? `Agent warnings: ${data.errors.join("; ")}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }));
      onSuccess();
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [chainKey]: err instanceof Error ? err.message : "Repay failed",
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {chains.map((chain) => {
        const cfg = contractsByChain[chain.chainKey as ChainKey];
        const hasLoan = Boolean(chain.loan?.active || chain.hasLocalLoan);
        return (
          <ChainLoanCard key={chain.chainKey} chain={chain}>
            {hasLoan && chain.loan ? (
              <div className="space-y-3 text-sm">
                <p>
                  Total due:{" "}
                  <strong>
                    {formatToken(chain.loan.totalDue)} {cfg.borrowSymbol}
                  </strong>
                </p>
                <button
                  type="button"
                  disabled={busy === chain.chainKey}
                  onClick={() => handleRepay(chain.chainKey as ChainKey)}
                  className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy === chain.chainKey ? "Repaying…" : "Repay loan"}
                </button>
                {status[chain.chainKey] && (
                  <p className="text-xs break-all text-zinc-600">{status[chain.chainKey]}</p>
                )}
                {(() => {
                  const outcome = outcomes[chain.chainKey];
                  if (!outcome) return null;
                  const uwTx = outcome.underwrite?.data?.tx;
                  const lzTxs = outcome.lz_sync?.data?.hub_tx_hashes ?? [];
                  const chainKey = chain.chainKey as ChainKey;
                  const repayUrl = outcome.repay_tx
                    ? txExplorerUrl(chainKey, outcome.repay_tx)
                    : null;
                  return (
                    <div className="space-y-2 rounded border border-emerald-100 bg-emerald-50/50 p-2 text-xs text-zinc-700 dark:border-emerald-900 dark:bg-emerald-950/20">
                      <p className="font-medium text-emerald-900 dark:text-emerald-200">
                        On-chain proof
                      </p>
                      {outcome.collateral_returned_eth != null && (
                        <p>
                          WETH collateral returned:{" "}
                          <strong>{Number(outcome.collateral_returned_eth).toFixed(6)} ETH</strong>
                        </p>
                      )}
                      {outcome.total_repaid != null && outcome.borrow_symbol && (
                        <p>
                          Borrow token repaid:{" "}
                          <strong>
                            {outcome.total_repaid} {outcome.borrow_symbol}
                          </strong>
                        </p>
                      )}
                      {outcome.repay_tx && (
                        <p className="break-all">
                          Repay tx:{" "}
                          {repayUrl ? (
                            <a
                              href={repayUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-700 underline dark:text-emerald-300"
                            >
                              {outcome.repay_tx}
                            </a>
                          ) : (
                            <code>{outcome.repay_tx}</code>
                          )}
                        </p>
                      )}
                      {outcome.receipt && (
                        <p>
                          Block {outcome.receipt.blockNumber} · gas {outcome.receipt.gasUsed} ·{" "}
                          {outcome.receipt.status}
                        </p>
                      )}
                      {outcome.underwrite?.ok && (
                        <p className="break-all">
                          Underwriter: {outcome.underwrite.data?.onchain || "ok"}
                          {uwTx ? ` · ${uwTx}` : ""}
                        </p>
                      )}
                      {lzTxs.length > 0 && (
                        <div className="space-y-0.5">
                          <p className="font-medium">LayerZero unlock (spokes):</p>
                          {lzTxs.map((t) => {
                            const url = txExplorerUrl(t.chain_key as ChainKey, t.tx_hash);
                            return (
                              <p key={`${t.chain_key}-${t.tx_hash}`} className="break-all pl-2">
                                {t.chain_key}:{" "}
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-700 underline dark:text-emerald-300"
                                  >
                                    {t.tx_hash}
                                  </a>
                                ) : (
                                  <code>{t.tx_hash}</code>
                                )}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No active loan to repay.</p>
            )}
          </ChainLoanCard>
        );
      })}
    </div>
  );
}
