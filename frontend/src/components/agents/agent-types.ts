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
};

export const AGENT_META: Record<
  AgentId,
  { label: string; description: string; canTrigger: boolean }
> = {
  underwriter: {
    label: "Underwriter",
    description: "Scores wallets and writes CredScore on-chain.",
    canTrigger: true,
  },
  portfolio_monitor: {
    label: "Portfolio Monitor",
    description: "Polls active loans for LTV, overdue status, and health warnings.",
    canTrigger: true,
  },
  liquidation: {
    label: "Liquidation",
    description: "Liquidates underwater loans and broadcasts defaults to spokes.",
    canTrigger: false,
  },
  crosschain_sync: {
    label: "Cross-Chain Sync",
    description: "Syncs scores and loan flags between hub and spoke chains.",
    canTrigger: true,
  },
  rate_optimizer: {
    label: "Rate Optimizer",
    description: "Adjusts base borrow rate from LP pool utilization.",
    canTrigger: true,
  },
};

export function mapAgentsFromRuns(runs: AgentRun[]) {
  return AGENT_IDS.map((id) => ({
    agent_id: id,
    last_run: runs.find((r) => r.agent_id === id) || null,
  }));
}

export function logsForAgent(agentId: string, logs: LogLine[], runs: AgentRun[]): LogLine[] {
  const runAgent = new Map(runs.map((r) => [r.id, r.agent_id]));
  return logs.filter((l) => l.agent_id === agentId || runAgent.get(l.run_id) === agentId);
}
