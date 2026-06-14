export const AGENT_IDS = [
  "underwriter",
  "portfolio_monitor",
  "liquidation",
  "crosschain_sync",
  "rate_optimizer",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentRun = {
  id: string;
  agent_id: string;
  status: string;
  trigger_source: string;
  trigger_event: string | null;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
};

export type LogLine = {
  id: string;
  run_id: string;
  logged_at: string;
  level: string;
  message: string;
  agent_id?: string;
  metadata?: Record<string, unknown> | null;
};

export const AGENT_META: Record<AgentId, { label: string; description: string }> = {
  underwriter: {
    label: "Underwriter",
    description: "Scores wallets and writes CredScore on-chain (mint & repay flows).",
  },
  portfolio_monitor: {
    label: "Portfolio Monitor",
    description: "Polls active loans for LTV, overdue status, and health warnings.",
  },
  liquidation: {
    label: "Liquidation",
    description: "Liquidates underwater loans and broadcasts defaults to spokes.",
  },
  crosschain_sync: {
    label: "Cross-Chain Sync",
    description: "Syncs scores and loan flags between hub and spoke chains.",
  },
  rate_optimizer: {
    label: "Rate Optimizer",
    description: "Adjusts base borrow rate from LP pool utilization.",
  },
};

export function mapAgentsFromRuns(runs: AgentRun[]) {
  const latest = new Map<string, AgentRun>();
  for (const run of runs) {
    if (!AGENT_IDS.includes(run.agent_id as AgentId)) continue;
    const existing = latest.get(run.agent_id);
    if (!existing || Date.parse(run.started_at) > Date.parse(existing.started_at)) {
      latest.set(run.agent_id, run);
    }
  }
  return AGENT_IDS.map((id) => ({
    agent_id: id,
    last_run: latest.get(id) || null,
  }));
}

export function logsForAgent(agentId: string, logs: LogLine[], runs: AgentRun[]): LogLine[] {
  const runAgent = new Map(runs.map((r) => [r.id, r.agent_id]));
  const seen = new Set<string>();
  return logs
    .filter((l) => l.agent_id === agentId || runAgent.get(l.run_id) === agentId)
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at));
}
