"use client";

import { AgentTriggerBadge } from "./AgentTriggerBadge";

const AGENT_LABELS: Record<string, string> = {
  underwriter: "Underwriter",
  portfolio_monitor: "Portfolio Monitor",
  liquidation: "Liquidation",
  crosschain_sync: "Cross-Chain Sync",
  rate_optimizer: "Rate Optimizer",
};

type AgentRun = {
  id: string;
  agent_id: string;
  status: string;
  trigger_source: string;
  trigger_event: string | null;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
};

type Props = {
  agentId: string;
  lastRun: AgentRun | null;
  selected: boolean;
  onSelect: () => void;
};

export function AgentCard({ agentId, lastRun, selected, onSelect }: Props) {
  const running = lastRun?.status === "running";
  const label = AGENT_LABELS[agentId] || agentId;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            running ? "animate-pulse bg-amber-500" : lastRun ? "bg-emerald-500" : "bg-zinc-300"
          }`}
        />
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {lastRun
          ? `Last: ${new Date(lastRun.started_at).toLocaleString()} — ${lastRun.status}`
          : "No runs yet"}
      </p>
      {lastRun && (
        <div className="mt-2">
          <AgentTriggerBadge source={lastRun.trigger_source} />
        </div>
      )}
    </button>
  );
}
