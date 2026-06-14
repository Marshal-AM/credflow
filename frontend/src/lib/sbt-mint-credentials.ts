import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSbtTokenId, HUB_SBT_CONTRACT } from "@/lib/sbt-chain";

type AgentRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger_event: string | null;
  related_tx_hashes: unknown;
  result: unknown;
};

export type SbtMintCredentials = {
  mintTxHash: string | null;
  sbtTokenId: string | null;
};

function parseTxHash(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("0x")) return null;
  return value;
}

function txFromAgentRun(run: AgentRunRow | null | undefined): string | null {
  if (!run) return null;

  const result = run.result as Record<string, unknown> | null | undefined;
  const data = result?.data as Record<string, unknown> | undefined;
  const direct = parseTxHash(data?.tx ?? result?.tx);
  if (direct) return direct;

  const related = run.related_tx_hashes;
  if (Array.isArray(related)) {
    for (const item of related) {
      const hash =
        typeof item === "string"
          ? parseTxHash(item)
          : parseTxHash((item as Record<string, unknown>)?.tx_hash);
      if (hash) return hash;
    }
  }
  return null;
}

async function txFromRunLogs(
  supabase: SupabaseClient,
  runId: string
): Promise<string | null> {
  const { data: lines } = await supabase
    .from("agent_log_lines")
    .select("metadata")
    .eq("run_id", runId)
    .order("logged_at", { ascending: false })
    .limit(40);

  for (const line of lines ?? []) {
    const meta = line.metadata as Record<string, unknown> | null | undefined;
    const hash = parseTxHash(meta?.tx_hash);
    if (!hash) continue;
    const onchain = String(meta?.onchain ?? "").toLowerCase();
    if (!onchain || onchain.includes("mint")) return hash;
  }
  return null;
}

/** Mint tx / token id tied to the latest score run or underwriter mint log — not older chain history. */
export async function resolveLatestSbtMintCredentials(
  wallet: `0x${string}`,
  supabase: SupabaseClient | null,
  options: {
    latestScoreRunCreatedAt?: string | null;
    profileMintTxHash?: string | null;
    profileMintedAt?: string | null;
  }
): Promise<SbtMintCredentials> {
  const empty: SbtMintCredentials = { mintTxHash: null, sbtTokenId: null };
  if (!supabase) return empty;

  const scoreBaseline = options.latestScoreRunCreatedAt
    ? Date.parse(options.latestScoreRunCreatedAt)
    : null;

  const isCurrentCycle = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    if (scoreBaseline == null || Number.isNaN(scoreBaseline)) return true;
    return t >= scoreBaseline;
  };

  const { data: runs } = await supabase
    .from("agent_runs")
    .select("id, started_at, finished_at, trigger_event, related_tx_hashes, result")
    .eq("wallet_address", wallet.toLowerCase())
    .eq("agent_id", "underwriter")
    .in("status", ["success", "completed"])
    .order("started_at", { ascending: false })
    .limit(10);

  const agentRuns = (runs ?? []) as AgentRunRow[];
  const mintRuns = agentRuns.filter((r) => isCurrentCycle(r.finished_at || r.started_at));

  const preferred =
    mintRuns.find((r) => r.trigger_event === "sbt_mint") ??
    mintRuns.find((r) => txFromAgentRun(r) != null) ??
    null;

  let mintTxHash = txFromAgentRun(preferred);
  if (!mintTxHash && preferred) {
    mintTxHash = await txFromRunLogs(supabase, preferred.id);
  }

  if (
    !mintTxHash &&
    options.profileMintTxHash &&
    isCurrentCycle(options.profileMintedAt)
  ) {
    mintTxHash = parseTxHash(options.profileMintTxHash);
  }

  if (!mintTxHash) return empty;

  const sbtTokenId = await fetchSbtTokenId(wallet, mintTxHash);
  return { mintTxHash, sbtTokenId };
}

export { HUB_SBT_CONTRACT };
