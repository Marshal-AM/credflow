"use client";

type StreamStatus = "connecting" | "live" | "poll" | "error";

const CONFIG: Record<
  StreamStatus,
  { label: string; dot: string; badge: string }
> = {
  live: {
    label: "Live",
    dot: "bg-emerald-400 animate-pulse",
    badge: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  },
  poll: {
    label: "Polling",
    dot: "bg-amber-400",
    badge: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  },
  connecting: {
    label: "Connecting",
    dot: "bg-muted-foreground/50 animate-pulse",
    badge: "border-border bg-muted/40 text-muted-foreground",
  },
  error: {
    label: "Offline",
    dot: "bg-red-400/80",
    badge: "border-red-400/25 bg-red-400/10 text-red-300",
  },
};

type Props = {
  status: StreamStatus;
};

export function AgentFeedBadge({ status }: Props) {
  const cfg = CONFIG[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-[650] uppercase tracking-wider ${cfg.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      {cfg.label}
    </span>
  );
}
