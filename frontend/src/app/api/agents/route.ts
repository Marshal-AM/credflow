import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { loadAgentRunsFromFiles } from "@/lib/agent-run-logs";

const AGENT_IDS = [
  "underwriter",
  "portfolio_monitor",
  "liquidation",
  "crosschain_sync",
  "rate_optimizer",
] as const;

export async function GET(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const agentFilter = req.nextUrl.searchParams.get("agent_id") || undefined;

    const { runs, logs, sessionDir } = loadAgentRunsFromFiles({
      wallet,
      agentId: agentFilter,
      runLimit: 50,
      logLimit: 200,
    });

    const agents = AGENT_IDS.map((id) => {
      const last = runs.find((r) => r.agent_id === id);
      return {
        agent_id: id,
        last_run: last || null,
      };
    });

    return NextResponse.json({
      wallet,
      agents,
      runs,
      logs,
      source: "local_files",
      session_dir: sessionDir,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load agents" },
      { status: 500 }
    );
  }
}
