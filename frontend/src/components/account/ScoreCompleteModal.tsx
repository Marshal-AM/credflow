"use client";

import { scoreTier } from "@/lib/score-tier";

type Props = {
  open: boolean;
  credScore?: number;
  bankUsd?: number;
  onClose: () => void;
};

export function ScoreCompleteModal({ open, credScore, bankUsd, onClose }: Props) {
  if (!open) return null;

  const tier = credScore != null ? scoreTier(credScore) : null;

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-md">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-2xl text-primary">
            ✓
          </div>
          <h3 className="mt-4 text-xl font-[650]">Your score is ready</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {tier ? (
              <>
                <span className="text-primary">{tier.label}</span>
                {" — "}
                {tier.description}
              </>
            ) : (
              "Review your results on the dashboard."
            )}
          </p>
        </div>

        <div className="mt-6 grid gap-3 text-sm">
          <div className="surface-row p-4 text-center">
            <p className="section-label">CredScore</p>
            <p className="mt-1 text-4xl font-[650] tabular-nums text-primary">
              {credScore ?? "—"}
            </p>
          </div>
          {bankUsd != null && bankUsd > 0 && (
            <div className="surface-row p-3">
              <p className="section-label">Verified bank balance</p>
              <p className="mt-1 text-lg font-[650]">
                ${bankUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          )}
        </div>

        <button type="button" onClick={onClose} className="btn-primary mt-6 w-full">
          View dashboard
        </button>
      </div>
    </div>
  );
}
