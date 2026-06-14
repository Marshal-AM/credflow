"use client";

import { scoreTier } from "@/lib/score-tier";

type Props = {
  credScore?: number;
  bankUsd?: number;
  sybilRisk?: string;
  onContinue: () => void;
};

export function ScoreCompletePanel({ credScore, bankUsd, sybilRisk, onContinue }: Props) {
  const tier = credScore != null ? scoreTier(credScore) : null;

  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center px-4 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/35 bg-primary/12 text-2xl text-primary">
        ✓
      </div>
      <h3 className="mt-4 text-xl font-[650] tracking-tight">Your score is ready</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {tier ? (
          <>
            <span className="font-[650] text-primary">{tier.label}</span>
            {" — "}
            {tier.description}
          </>
        ) : (
          "Review your updated dashboard."
        )}
      </p>

      <div className="mt-6 grid w-full max-w-sm gap-3">
        <div className="surface-row p-4 text-center">
          <p className="section-label">CredScore</p>
          <p className="mt-1 text-4xl font-[650] tabular-nums text-primary">{credScore ?? "—"}</p>
        </div>
        {sybilRisk && (
          <div className="surface-row flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-muted-foreground">Sybil risk</span>
            <span className="font-[650] capitalize text-foreground">{sybilRisk}</span>
          </div>
        )}
        {bankUsd != null && bankUsd > 0 && (
          <div className="surface-row px-4 py-3 text-left text-sm">
            <p className="section-label">Verified bank balance</p>
            <p className="mt-1 text-lg font-[650]">
              ${bankUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        )}
      </div>

      <button type="button" onClick={onContinue} className="btn-primary mt-8 px-8 py-3 text-[0.9375rem]">
        View dashboard
      </button>
    </div>
  );
}
