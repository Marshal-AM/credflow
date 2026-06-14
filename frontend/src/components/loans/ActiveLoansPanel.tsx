"use client";

import { useMemo, useState } from "react";
import { ChainCredScore } from "./ChainCredScore";
import { LoansPanelShell } from "./LoansPanelShell";
import type { ChainSummary } from "./loans-types";
import { contractsByChain } from "@/lib/contracts";
import { COLLATERAL_SYMBOL } from "@/lib/chain-logos";
import type { ChainKey } from "@/lib/chains";

type Props = {
  chains: ChainSummary[];
};

function formatToken(amount: string, decimals = 6): string {
  const n = Number(amount) / 10 ** decimals;
  return n.toFixed(4);
}

function formatEth(wei: string): string {
  return (Number(wei) / 1e18).toFixed(6);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-3 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-[650] tabular-nums text-right">{value}</span>
    </div>
  );
}

export function ActiveLoansPanel({ chains }: Props) {
  const activeChains = useMemo(
    () => chains.filter((c) => c.loan?.active === true),
    [chains]
  );

  const [selectedChainKey, setSelectedChainKey] = useState<string | null>(null);

  const selectedChain = useMemo(() => {
    if (!selectedChainKey) return null;
    return activeChains.find((c) => c.chainKey === selectedChainKey) ?? null;
  }, [activeChains, selectedChainKey]);

  const chainOptions = useMemo(
    () => activeChains.map((c) => ({ chainKey: c.chainKey, label: c.label })),
    [activeChains]
  );

  if (!activeChains.length) {
    return (
      <div className="card-padded text-sm text-muted-foreground">
        <p>No active loans on any chain.</p>
        <p className="mt-2 text-xs text-subtle">
          If you just borrowed, refresh after the tx confirms. A reverted borrow (wrong collateral or
          pool limits) will not appear here — check the Borrow tab status message or block explorer.
        </p>
      </div>
    );
  }

  const loan = selectedChain?.loan;
  const cfg = selectedChain
    ? contractsByChain[selectedChain.chainKey as ChainKey]
    : null;
  const due = loan ? new Date(Number(loan.dueTime) * 1000) : null;

  return (
    <LoansPanelShell
      title="Active loans"
      chainOptions={chainOptions}
      selectedChainKey={selectedChainKey}
      onChainChange={setSelectedChainKey}
      chainPlaceholder="Select chain with active loan"
    >
      {!selectedChain || !loan || !cfg ? (
        <p className="text-sm text-muted-foreground">
          Select a chain to view your active loan details.
        </p>
      ) : (
        <>
          <ChainCredScore
            score={selectedChain.score}
            eligible={selectedChain.eligible}
            chainLabel={selectedChain.label}
          />

          <div className="surface-row px-4 py-1">
            <DetailRow label="Loan #" value={loan.loanId} />
            <DetailRow
              label="Borrowed"
              value={`${formatToken(loan.borrowedAmount)} ${cfg.borrowSymbol}`}
            />
            <DetailRow
              label="Collateral"
              value={`${formatEth(loan.collateralAmount)} ${COLLATERAL_SYMBOL}`}
            />
            <DetailRow
              label="Interest"
              value={`${formatToken(loan.interest)} ${cfg.borrowSymbol}`}
            />
            <DetailRow
              label="Total due"
              value={`${formatToken(loan.totalDue)} ${cfg.borrowSymbol}`}
            />
            <DetailRow label="Due date" value={due!.toLocaleDateString()} />
            <DetailRow label="Max LTV" value={`${(Number(loan.maxLTV) / 100).toFixed(0)}%`} />
            <DetailRow
              label="Interest rate"
              value={`${(Number(loan.interestRate) / 100).toFixed(2)}%`}
            />
          </div>

          <div className="rounded-full bg-primary/15 px-3 py-1.5 text-center text-xs font-[650] uppercase tracking-wider text-primary">
            Active loan on {selectedChain.label}
          </div>
        </>
      )}
    </LoansPanelShell>
  );
}
