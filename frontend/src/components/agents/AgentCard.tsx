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
      className={`card-padded text-left transition-spring hover:scale-[1.02] ${
        selected
          ? "border-primary/50 bg-primary/5"
          : "hover:border-primary/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            running ? "animate-pulse bg-primary" : lastRun ? "bg-emerald-400" : "bg-muted-foreground/30"
          }`}
        />
        <h3 className="text-sm font-[650]">{label}</h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
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
