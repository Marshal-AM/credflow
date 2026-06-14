import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { loadAgentRuns } from "@/lib/agent-runs";
import { mapAgentsFromRuns } from "@/components/agents/agent-types";

export async function GET(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const agentFilter = req.nextUrl.searchParams.get("agent_id") || undefined;

    const { runs, logs } = await loadAgentRuns({
      wallet,
      agentId: agentFilter,
      runLimit: 50,
      logLimit: 2000,
    });

    return NextResponse.json({
      wallet,
      agents: mapAgentsFromRuns(runs),
      runs,
      logs,
      source: "supabase",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load agents" },
      { status: 500 }
    );
  }
}
