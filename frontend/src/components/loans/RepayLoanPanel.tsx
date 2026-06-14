"use client";

import { useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { ChainCredScore } from "./ChainCredScore";
import { LoansPanelShell } from "./LoansPanelShell";
import type { ChainSummary } from "./loans-types";
import { contractsByChain, LENDING_ABI } from "@/lib/contracts";
import { txExplorerUrl, chainIdByKey, type ChainKey } from "@/lib/chains";
import { useEnsureChain } from "@/hooks/use-ensure-chain";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { clientRepayLoan } from "@/lib/loan-client";
import { COLLATERAL_SYMBOL } from "@/lib/chain-logos";
import { toast } from "@/lib/toast";

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

function RepayChainContent({
  chain,
  onSuccess,
  busy,
  onBusy,
}: {
  chain: ChainSummary;
  onSuccess: () => void;
  busy: boolean;
  onBusy: (v: boolean) => void;
}) {
  const chainKey = chain.chainKey as ChainKey;
  const cfg = contractsByChain[chainKey];
  const { address, isConnected } = useAccount();
  const { apiFetch } = useWalletApi();
  const { ensureChain } = useEnsureChain(chainKey);
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RepayOutcome | null>(null);
  const targetChainId = chainIdByKey[chainKey];

  const hasLoan = Boolean(chain.loan?.active || chain.hasLocalLoan);

  const { data: onChainLoanId } = useReadContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "activeLoanId",
    args: address ? [address] : undefined,
    chainId: targetChainId,
    query: { enabled: !!address && !!cfg.lending && hasLoan },
  });

  const loanId = onChainLoanId ?? (chain.loan?.loanId ? BigInt(chain.loan.loanId) : 0n);

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
    query: { enabled: !!cfg.lending && hasLoan },
  });

  async function handleRepay() {
    if (!address || !loanRaw || !borrowToken || loanId === 0n) return;
    onBusy(true);
    setStatus("Switching network and signing repay…");
    try {
      const totalDue = loanRaw.borrowedAmount + (interest ?? 0n);
      const { txHash, totalRepaidFormatted, borrowSymbol } = await clientRepayLoan({
        chainKey,
        loanId,
        totalDue,
        borrowToken: borrowToken as `0x${string}`,
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
          collateral_returned_eth: chain.loan?.collateralAmount
            ? (Number(chain.loan.collateralAmount) / 1e18).toFixed(6)
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Repay confirmation failed");

      setOutcome({
        repay_tx: data.repay_tx,
        collateral_returned_eth: data.collateral_returned_eth,
        total_repaid: data.total_repaid,
        borrow_symbol: data.borrow_symbol ?? borrowSymbol,
        receipt: data.receipt,
        old_score: data.old_score,
        new_score: data.new_score,
        score_delta: data.score_delta,
        errors: data.errors,
        underwrite: data.underwrite,
        lz_sync: data.lz_sync,
      });

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
      onBusy(false);
    }
  }

  if (!hasLoan || !chain.loan) {
    return (
      <p className="text-sm text-muted-foreground">No active loan to repay on this chain.</p>
    );
  }

  return (
    <>
      <ChainCredScore
        score={chain.score}
        eligible={chain.eligible}
        chainLabel={chain.label}
      />

      <div className="surface-row px-4 py-4">
        <p className="section-label">Amount due</p>
        <p className="mt-2 text-2xl font-[650] tabular-nums tracking-tight">
          {formatToken(chain.loan.totalDue)}{" "}
          <span className="text-base text-muted-foreground">{cfg.borrowSymbol}</span>
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Loan #{chain.loan.loanId} · Collateral returned in {COLLATERAL_SYMBOL} after repay
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy || !isConnected || loanId === 0n}
          onClick={() => void handleRepay()}
          className="btn-primary min-w-[220px] disabled:opacity-50"
        >
          {busy ? "Repaying…" : `Repay on ${chain.label}`}
        </button>
      </div>

      {status && (
        <p className="text-right text-xs break-all text-muted-foreground font-mono">{status}</p>
      )}

      {outcome && (
        <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs">
          <p className="font-[650] text-primary">On-chain proof</p>
          {outcome.repay_tx && (
            <p className="break-all">
              Repay tx:{" "}
              {txExplorerUrl(chainKey, outcome.repay_tx) ? (
                <a
                  href={txExplorerUrl(chainKey, outcome.repay_tx)!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {outcome.repay_tx}
                </a>
              ) : (
                <code className="font-mono">{outcome.repay_tx}</code>
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function RepayLoanPanel({ chains, onSuccess }: Props) {
  const [selectedChainKey, setSelectedChainKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const repayableChains = useMemo(
    () => chains.filter((c) => c.loan?.active || c.hasLocalLoan),
    [chains]
  );

  const selectedChain = useMemo(() => {
    if (!selectedChainKey) return null;
    return repayableChains.find((c) => c.chainKey === selectedChainKey) ?? null;
  }, [repayableChains, selectedChainKey]);

  const chainOptions = useMemo(
    () => repayableChains.map((c) => ({ chainKey: c.chainKey, label: c.label })),
    [repayableChains]
  );

  if (!repayableChains.length) {
    return (
      <div className="card-padded text-sm text-muted-foreground">
        <p>No loans to repay.</p>
        <p className="mt-2 text-xs text-subtle">
          Open a loan from the Borrow tab, then return here after it confirms on-chain.
        </p>
      </div>
    );
  }

  return (
    <LoansPanelShell
      title="Repay"
      chainOptions={chainOptions}
      selectedChainKey={selectedChainKey}
      onChainChange={setSelectedChainKey}
      chainPlaceholder="Select chain to repay"
    >
      {!selectedChain ? (
        <p className="text-sm text-muted-foreground">
          Select a chain to view the amount due and repay your loan.
        </p>
      ) : (
        <RepayChainContent
          key={selectedChain.chainKey}
          chain={selectedChain}
          onSuccess={onSuccess}
          busy={busy}
          onBusy={setBusy}
        />
      )}
    </LoansPanelShell>
  );
}
