import type { ReactNode } from "react";

type Props = {
  reason: string;
  hint?: string;
  loading?: boolean;
  action?: ReactNode;
};

function BlockedIcon() {
  return (
    <svg
      className="h-6 w-6 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function DefaultScenarioBlocked({ reason, hint, loading, action }: Props) {
  return (
    <div
      className="td-scenario-blocked flex min-h-[17rem] flex-col items-center justify-center rounded-xl border border-border/60 bg-card/30 px-6 py-10 text-center"
      role={loading ? "status" : undefined}
      aria-live={loading ? "polite" : undefined}
    >
      {loading ? (
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-shimmer rounded-full" aria-hidden />
          <p className="text-sm font-medium text-muted-foreground">Loading wallet state…</p>
        </div>
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border/70 bg-card/60"
            aria-hidden
          >
            <BlockedIcon />
          </div>
          <p className="section-label">Scenario unavailable</p>
          <h3 className="text-base font-[650] leading-snug tracking-tight text-foreground sm:text-lg">
            {reason}
          </h3>
          {hint ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
          ) : null}
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      )}
    </div>
  );
}
