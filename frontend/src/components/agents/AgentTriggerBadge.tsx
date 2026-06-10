"use client";

const LABELS: Record<string, string> = {
  scheduler: "Scheduler",
  defender_sentinel: "Defender Sentinel",
  defender_cron: "Defender Cron",
  api_hook: "API hook",
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
      ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200"
      : source === "defender_sentinel"
        ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
        : source === "api_hook"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${color}`}>
      {label}
    </span>
  );
}
