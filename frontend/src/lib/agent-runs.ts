import { getSupabaseAdmin } from "@/lib/supabase-server";
import { AGENT_IDS, type AgentRun, type LogLine } from "@/components/agents/agent-types";

const LOG_RUNS_PER_AGENT = 8;

type LoadOptions = {
  wallet?: string;
  agentId?: string;
  runLimit?: number;
  logLimit?: number;
};

export type AgentRunsPayload = {
  runs: AgentRun[];
  logs: LogLine[];
};

function mapRun(row: {
  id: string;
  agent_id: string;
  trigger_source: string;
  trigger_event: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
}): AgentRun {
  return {
    id: row.id,
    agent_id: row.agent_id,
    status: row.status,
    trigger_source: row.trigger_source,
    trigger_event: row.trigger_event,
    started_at: row.started_at,
    finished_at: row.finished_at,
    summary: row.summary,
  };
}

function selectRunIdsForLogs(runs: AgentRun[], agentFilter?: string): string[] {
  const tracked = agentFilter ? [agentFilter] : [...AGENT_IDS];
  const byAgent = new Map<string, AgentRun[]>();

  for (const run of runs) {
    if (!tracked.includes(run.agent_id)) continue;
    const list = byAgent.get(run.agent_id) ?? [];
    list.push(run);
    byAgent.set(run.agent_id, list);
  }

  const ids: string[] = [];
  for (const agentId of tracked) {
    const agentRuns = (byAgent.get(agentId) ?? [])
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .slice(0, LOG_RUNS_PER_AGENT);
    ids.push(...agentRuns.map((r) => r.id));
  }
  return [...new Set(ids)];
}

export async function loadAgentRuns(options?: LoadOptions): Promise<AgentRunsPayload> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  }

  const runLimit = options?.runLimit ?? 50;
  const logLimit = options?.logLimit ?? 2000;
  const wallet = options?.wallet?.toLowerCase();
  const agentFilter = options?.agentId;

  let runsQuery = supabase
    .from("agent_runs")
    .select(
      "id, agent_id, wallet_address, trigger_source, trigger_event, status, started_at, finished_at, summary"
    )
    .in("agent_id", agentFilter ? [agentFilter] : [...AGENT_IDS])
    .order("started_at", { ascending: false })
    .limit(runLimit);

  if (wallet) {
    runsQuery = runsQuery.or(`wallet_address.is.null,wallet_address.eq.${wallet}`);
  }

  const { data: runRows, error: runsError } = await runsQuery;
  if (runsError) {
    throw new Error(runsError.message);
  }

  const runs = (runRows ?? []).map(mapRun);
  const runIds = selectRunIdsForLogs(runs, agentFilter);

  if (!runIds.length) {
    return { runs, logs: [] };
  }

  const runAgent = new Map(runs.map((r) => [r.id, r.agent_id]));

  const { data: logRows, error: logsError } = await supabase
    .from("agent_log_lines")
    .select("id, run_id, logged_at, level, message, metadata")
    .in("run_id", runIds)
    .order("logged_at", { ascending: true })
    .limit(logLimit);

  if (logsError) {
    throw new Error(logsError.message);
  }

  const logs: LogLine[] = (logRows ?? []).map((row) => ({
    id: row.id,
    run_id: row.run_id,
    logged_at: row.logged_at,
    level: row.level,
    message: row.message,
    agent_id: runAgent.get(row.run_id),
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));

  return { runs, logs };
}
