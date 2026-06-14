"use client";

import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { useLoansChain } from "./LoansChainContext";
import type { ChainSummary } from "./loans-types";
import { contractsByChain, LENDING_ABI } from "@/lib/contracts";
import { chainIdByKey, type ChainKey } from "@/lib/chains";
import { useEnsureChain } from "@/hooks/use-ensure-chain";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { clientRepayLoan } from "@/lib/loan-client";
import { COLLATERAL_SYMBOL } from "@/lib/chain-logos";
import { toast } from "@/lib/toast";

type Props = {
  onSuccess: () => void;
};

function formatToken(amount: string, decimals = 6): string {
  return (Number(amount) / 10 ** decimals).toFixed(4);
}

function formatEth(wei: string): string {
  return (Number(wei) / 1e18).toFixed(6);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-[650] tabular-nums text-right">{value}</span>
    </div>
  );
}

function ActiveLoanCard({
  chain,
  onSuccess,
}: {
  chain: ChainSummary;
  onSuccess: () => void;
}) {
  const chainKey = chain.chainKey as ChainKey;
  const cfg = contractsByChain[chainKey];
  const loan = chain.loan!;
  const targetChainId = chainIdByKey[chainKey];
  const { address, isConnected } = useAccount();
  const { apiFetch } = useWalletApi();
  const { ensureChain } = useEnsureChain(chainKey);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: targetChainId });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const { data: onChainLoanId } = useReadContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "activeLoanId",
    args: address ? [address] : undefined,
    chainId: targetChainId,
    query: { enabled: !!address && !!cfg.lending },
  });

  const loanId = onChainLoanId ?? BigInt(loan.loanId);

  const { data: loanRaw } = useReadContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "loans",
    args: loanId > 0n ? [loanId] : undefined,
    chainId: targetChainId,
    query: { enabled: !!cfg.lending && loanId > 0n },
  });

  const { data: interest } = useReadContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "calculateInterest",
    args: loanRaw ? [loanRaw] : undefined,
    chainId: targetChainId,
    query: { enabled: !!loanRaw && !!cfg.lending },
  });

  const { data: borrowToken } = useReadContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "borrowToken",
    chainId: targetChainId,
    query: { enabled: !!cfg.lending },
  });

  const due = new Date(Number(loan.dueTime) * 1000);

  async function handleRepay() {
    if (!address || !loanRaw || !borrowToken || loanId === 0n || !publicClient) return;
    setBusy(true);
    setStatus("Switching network and signing repay…");
    try {
      const totalDue = loanRaw.borrowedAmount + (interest ?? 0n);
      const { txHash, totalRepaidFormatted } = await clientRepayLoan({
        chainKey,
        loanId,
        totalDue,
        borrowToken: borrowToken as `0x${string}`,
        publicClient,
        writeContractAsync,
        ensureChain,
      });

      const res = await apiFetch("/api/loans/repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_key: chainKey,
          tx_hash: txHash,
          loan_id: loanId.toString(),
          total_repaid: totalRepaidFormatted,
          collateral_returned_eth: (Number(loan.collateralAmount) / 1e18).toFixed(6),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Repay confirmation failed");

      toast.success(`Loan repaid on ${chain.label}`, `repay-${chain.chainKey}`);
      if (data.errors?.length) {
        toast.warning(String(data.errors[0]), `repay-warn-${chain.chainKey}`);
      }
      setStatus(null);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Repay failed";
      toast.error(msg, `repay-error-${chain.chainKey}`);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-border/55 bg-card/50 shadow-sm">
      <div className="border-b border-border/45 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-label">Active loan</p>
            <h3 className="mt-1 text-lg font-[650] tracking-tight">{chain.label}</h3>
          </div>
          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-[650] uppercase tracking-wider text-primary">
            Loan #{loan.loanId}
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3">
          <p className="section-label">Amount due</p>
          <p className="mt-2 text-2xl font-[650] tabular-nums tracking-tight">
            {formatToken(loan.totalDue)}{" "}
            <span className="text-base font-normal text-muted-foreground">{cfg.borrowSymbol}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Due {due.toLocaleDateString(undefined, { dateStyle: "medium" })}
          </p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3">
          <p className="section-label">Collateral locked</p>
          <p className="mt-2 text-2xl font-[650] tabular-nums tracking-tight">
            {formatEth(loan.collateralAmount)}{" "}
            <span className="text-base font-normal text-muted-foreground">{COLLATERAL_SYMBOL}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Returned after full repay</p>
        </div>
      </div>

      <div className="border-t border-border/40 px-5 py-3">
        <DetailRow label="Borrowed" value={`${formatToken(loan.borrowedAmount)} ${cfg.borrowSymbol}`} />
        <DetailRow label="Interest accrued" value={`${formatToken(loan.interest)} ${cfg.borrowSymbol}`} />
        <DetailRow label="Max LTV" value={`${(Number(loan.maxLTV) / 100).toFixed(0)}%`} />
        <DetailRow
          label="Interest rate"
          value={`${(Number(loan.interestRate) / 100).toFixed(2)}%`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/45 px-5 py-4">
        {status ? (
          <p className="text-xs text-muted-foreground font-mono">{status}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Repay unlocks collateral and updates your CredScore on-chain.
          </p>
        )}
        <button
          type="button"
          disabled={busy || !isConnected || loanId === 0n}
          onClick={() => void handleRepay()}
          className="btn-primary min-w-[180px] disabled:opacity-50"
        >
          {busy ? "Repaying…" : "Repay loan"}
        </button>
      </div>
    </article>
  );
}

export function ActiveLoansPanel({ onSuccess }: Props) {
  const { selectedChain, selectedChainKey } = useLoansChain();

  const hasActiveLoan =
    selectedChain?.loan?.active === true ||
    Boolean(selectedChain?.hasLocalLoan && selectedChain.loan);

  if (!selectedChainKey) {
    return (
      <div className="card-padded text-sm text-muted-foreground">
        <p>Select a chain above to view your active loan.</p>
      </div>
    );
  }

  if (!hasActiveLoan || !selectedChain?.loan) {
    return (
      <div className="card-padded text-sm text-muted-foreground">
        <p>No active loan on {selectedChain?.label ?? "this chain"}.</p>
        <p className="mt-2 text-xs text-subtle">
          If you just borrowed, refresh after the tx confirms. A reverted borrow will not appear
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ActiveLoanCard chain={selectedChain} onSuccess={onSuccess} />
    </div>
  );
}
