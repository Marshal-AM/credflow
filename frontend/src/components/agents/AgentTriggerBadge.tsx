"use client";

const LABELS: Record<string, string> = {
  scheduler: "Scheduler",
  defender_sentinel: "Defender Sentinel",
  defender_cron: "Defender Cron",
  api_hook: "API hook",
  test_default_ui: "Test default",
  manual: "Manual",
  frontend: "Frontend",
};

type Props = {
  source: string;
};

export function AgentTriggerBadge({ source }: Props) {
  const label = LABELS[source] || source;
  const color =
    source === "scheduler"
      ? "bg-indigo-400/15 text-indigo-300"
      : source === "defender_sentinel"
        ? "bg-violet-400/15 text-violet-300"
        : source === "api_hook"
          ? "bg-sky-400/15 text-sky-300"
          : "bg-muted text-muted-foreground";

  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-[650] uppercase tracking-wider ${color}`}
    >
      {label}
    </span>
  );
}
