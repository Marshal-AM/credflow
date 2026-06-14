"use client";

import { useMemo } from "react";
import Image from "next/image";
import { useLoansChain } from "./LoansChainContext";
import { contractsByChain } from "@/lib/contracts";
import { txExplorerUrl, type ChainKey } from "@/lib/chains";
import { chainLogoSrc } from "@/lib/chain-logos";
import type { LoanEvent } from "./loans-types";

function formatDate(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function HistoryRow({ event }: { event: LoanEvent }) {
  const chainKey = event.chain_key as ChainKey;
  const cfg = contractsByChain[chainKey];
  const label = cfg?.label ?? event.chain_key;
  const explorer = txExplorerUrl(chainKey, event.tx_hash);

  return (
    <li className="rounded-xl border border-border/50 bg-card/45 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src={chainLogoSrc(chainKey)}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-full object-cover"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-[650]">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {event.loan_id != null ? `Loan #${event.loan_id}` : "Loan"} · Repaid{" "}
              {formatDate(event.created_at)}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-[650] uppercase tracking-wider text-emerald-400">
          Repaid
        </span>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {event.borrow_amount != null && (
          <div className="flex justify-between gap-3 rounded-lg bg-muted/20 px-3 py-2">
            <dt className="text-muted-foreground">Repaid</dt>
            <dd className="font-[650] tabular-nums">
              {event.borrow_amount} {event.borrow_token ?? cfg?.borrowSymbol ?? ""}
            </dd>
          </div>
        )}
        {event.collateral_amount != null && (
          <div className="flex justify-between gap-3 rounded-lg bg-muted/20 px-3 py-2">
            <dt className="text-muted-foreground">Collateral returned</dt>
            <dd className="font-[650] tabular-nums">{event.collateral_amount} ETH</dd>
          </div>
        )}
      </dl>

      {explorer ? (
        <a
          href={explorer}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs font-[650] text-primary underline decoration-border/60 underline-offset-2"
        >
          View repay transaction
        </a>
      ) : (
        <p className="mt-3 break-all font-mono text-[10px] text-muted-foreground">{event.tx_hash}</p>
      )}
    </li>
  );
}

export function LoanHistoryPanel() {
  const { loanEvents, selectedChainKey, selectedChain } = useLoansChain();

  const repaidEvents = useMemo(() => {
    return loanEvents
      .filter((e) => e.event_type === "repaid")
      .filter((e) => !selectedChainKey || e.chain_key === selectedChainKey)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [loanEvents, selectedChainKey]);

  if (!selectedChainKey) {
    return (
      <div className="card-padded text-sm text-muted-foreground">
        <p>Select a chain above to view repay history.</p>
      </div>
    );
  }

  if (!repaidEvents.length) {
    return (
      <div className="card-padded text-sm text-muted-foreground">
        <p>No repaid loans on {selectedChain?.label ?? "this chain"} yet.</p>
        <p className="mt-2 text-xs text-subtle">
          Completed repays are recorded here after you repay from the Active loans tab.
        </p>
      </div>
    );
  }

  return (
    <div className="card-padded space-y-4">
      <div>
        <h2 className="text-lg font-[650] tracking-tight">Repay history</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Past loans you fully repaid on {selectedChain?.label}.
        </p>
      </div>
      <ul className="space-y-3">
        {repaidEvents.map((event) => (
          <HistoryRow key={event.id} event={event} />
        ))}
      </ul>
    </div>
  );
}
