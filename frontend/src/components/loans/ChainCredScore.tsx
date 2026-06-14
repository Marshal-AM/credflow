"use client";

import { scoreTier } from "@/lib/score-tier";
import { CredScoreGaugeMini } from "@/components/account/CredScoreGauge";

type Props = {
  score: number;
  eligible: boolean;
  chainLabel: string;
};

export function ChainCredScore({ score, eligible, chainLabel }: Props) {
  if (score <= 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/20 px-5 py-4">
        <p className="section-label">CredScore on {chainLabel}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          No CredScore yet. Build your score on the dashboard first.
        </p>
      </div>
    );
  }

  const tier = scoreTier(score);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/40 px-5 py-4">
      <div>
        <p className="section-label">CredScore · {chainLabel}</p>
        <div className="mt-1 flex items-center gap-2.5">
          <CredScoreGaugeMini score={score} />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-4xl font-[650] tabular-nums tracking-tight text-primary sm:text-5xl">
              {score}
            </span>
            <span className="text-sm font-[650] uppercase tracking-[0.14em] text-primary">
              {tier.label}
            </span>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
      </div>
      <div className="rounded-full bg-primary/15 px-3 py-1 text-xs font-[650] uppercase tracking-wider text-primary">
        {eligible ? "Eligible to borrow" : "Not eligible"}
      </div>
    </div>
  );
}
