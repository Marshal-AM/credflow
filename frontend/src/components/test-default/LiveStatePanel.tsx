"use client";

import type { DefaultTestStatus } from "@/lib/test-default-server";
import type { StepResult } from "@/lib/test-default/flow-steps";
import { txExplorerUrl, normalizeTxHash } from "@/lib/chains";

function bpsToPct(bps: number | null): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  const valueClass =
    tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-[650] text-right ${valueClass}`}>{value}</span>
    </div>
  );
}

type Props = {
  status: DefaultTestStatus | null;
  open: boolean;
  onToggle: () => void;
  onRefresh: () => void;
};

export function LiveStatePanel({
  status,
  open,
  onToggle,
  onRefresh,
}: Props) {
  return (
    <section className="card-shell overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <svg
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-lg font-[650] tracking-tight">Live state</h2>
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onRefresh} className="btn-secondary text-sm">
            Refresh
          </button>
        </div>
      </div>

      {open && (
        <div className="td-collapse-panel td-collapse-panel--open border-t border-border/50">
          <div className="td-collapse-panel__inner px-4 pb-4 pt-3">
          {!status ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 rounded-xl border border-border/50 bg-card/40 p-4">
                <p className="section-label">Hub loan</p>
                <DetailRow
                  label="Active loan"
                  value={status.hub.loanActive ? `#${status.hub.loanId}` : "None"}
                />
                <DetailRow label="Due" value={status.hub.dueTime ?? "—"} />
                <DetailRow
                  label="Overdue"
                  value={status.hub.overdue ? "Yes" : "No"}
                  tone={status.hub.overdue ? "negative" : undefined}
                />
              </div>
              <div className="space-y-2 rounded-xl border border-border/50 bg-card/40 p-4">
                <p className="section-label">Risk</p>
                <DetailRow label="LTV" value={bpsToPct(status.hub.ltvBps)} />
                <DetailRow
                  label="Liquidation at"
                  value={bpsToPct(status.hub.liquidationThresholdBps)}
                />
                <DetailRow
                  label="Liquidatable"
                  value={status.ready.liquidatable ? "Yes" : "No"}
                  tone={status.ready.liquidatable ? "negative" : undefined}
                />
              </div>
              <div className="space-y-2 rounded-xl border border-border/50 bg-card/40 p-4">
                <p className="section-label">Credential</p>
                <DetailRow label="Hub score" value={String(status.hub.score)} />
                <DetailRow label="Defaults" value={String(status.hub.defaultCount)} />
                <DetailRow
                  label="Blacklisted"
                  value={status.hub.hubBlacklisted ? "Yes" : "No"}
                  tone={status.hub.hubBlacklisted ? "negative" : undefined}
                />
              </div>
              {status.spokes.map((s) => (
                <div
                  key={s.chainKey}
                  className="space-y-2 rounded-xl border border-border/50 bg-card/40 p-4"
                >
                  <p className="section-label">{s.label}</p>
                  <DetailRow label="Score" value={String(s.score)} />
                  <DetailRow
                    label="LZ blacklist"
                    value={s.lzBlacklisted ? "Yes" : "No"}
                    tone={s.lzBlacklisted ? "negative" : undefined}
                  />
                  <DetailRow label="Loan mirror" value={s.lzLoanActive ? "Active" : "None"} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </section>
  );
}

function shortTxHash(tx: string): string {
  if (tx.length < 14) return tx;
  return `${tx.slice(0, 10)}…${tx.slice(-6)}`;
}

export function TxList({ txs }: { txs: string[] }) {
  if (!txs.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {txs.map((tx) => {
        const normalized = normalizeTxHash(tx);
        const href = txExplorerUrl("hub", normalized);
        return (
          <li key={tx}>
            <a
              href={href ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-primary inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] no-underline"
              title={normalized}
            >
              {shortTxHash(normalized)}
              <span aria-hidden className="text-muted-foreground">
                ↗
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export type { StepResult };
