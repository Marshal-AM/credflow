import type { ReactNode } from "react";

type Props = {
  reason: string;
  hint?: string;
  loading?: boolean;
  action?: ReactNode;
  /** Right column — e.g. persisted linked-wallet graph when blacklisted */
  graph?: ReactNode;
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

export function DefaultScenarioBlocked({ reason, hint, loading, action, graph }: Props) {
  if (loading) {
    return (
      <div
        className="td-scenario-blocked flex min-h-[17rem] flex-col items-center justify-center rounded-xl border border-border/60 bg-card/30 px-6 py-10 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-shimmer rounded-full" aria-hidden />
          <p className="text-sm font-medium text-muted-foreground">Loading wallet state…</p>
        </div>
      </div>
    );
  }

  const message = (
    <div className={`flex flex-col gap-3 ${graph ? "items-start text-left" : "mx-auto max-w-md items-center text-center"}`}>
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
      {hint ? <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );

  if (graph) {
    return (
      <div className="grid min-h-[17rem] gap-4 rounded-xl border border-border/60 bg-card/30 p-4 lg:grid-cols-2 lg:gap-6 lg:p-6">
        <div className="flex flex-col justify-center py-2">{message}</div>
        <div className="flex min-h-[12rem] flex-col justify-center">{graph}</div>
      </div>
    );
  }

  return (
    <div className="td-scenario-blocked flex min-h-[17rem] flex-col items-center justify-center rounded-xl border border-border/60 bg-card/30 px-6 py-10 text-center">
      {message}
    </div>
  );
}
