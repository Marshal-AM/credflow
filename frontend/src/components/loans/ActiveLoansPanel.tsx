"use client";

import { ChainLoanCard } from "./ChainLoanCard";
import { contractsByChain } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";

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
  loan: LoanData | null;
};

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

export function ActiveLoansPanel({ chains }: Props) {
  const active = chains.filter((c) => c.loan?.active === true);

  if (!active.length) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
        <p>No active loans on any chain.</p>
        <p className="mt-2 text-xs text-zinc-400">
          If you just borrowed, refresh after the tx confirms. A reverted borrow (wrong collateral or
          pool limits) will not appear here — check the Purchase tab status message or block explorer.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {active.map((chain) => {
        const loan = chain.loan;
        if (!loan) return null;
        const cfg = contractsByChain[chain.chainKey as ChainKey];
        const due = new Date(Number(loan.dueTime) * 1000);
        return (
          <ChainLoanCard key={chain.chainKey} chain={chain}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Loan #</dt>
                <dd>{loan.loanId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Borrowed</dt>
                <dd>
                  {formatToken(loan.borrowedAmount)} {cfg.borrowSymbol}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Collateral</dt>
                <dd>{formatEth(loan.collateralAmount)} WETH</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Interest</dt>
                <dd>{formatToken(loan.interest)} {cfg.borrowSymbol}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Total due</dt>
                <dd className="font-medium">
                  {formatToken(loan.totalDue)} {cfg.borrowSymbol}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Due</dt>
                <dd>{due.toLocaleDateString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Max LTV</dt>
                <dd>{(Number(loan.maxLTV) / 100).toFixed(0)}%</dd>
              </div>
            </dl>
          </ChainLoanCard>
        );
      })}
    </div>
  );
}
