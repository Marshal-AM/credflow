import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { triggerAgent } from "@/lib/agent-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const agentId = body.agent_id as string;
    if (!agentId) {
      return NextResponse.json({ error: "agent_id required" }, { status: 400 });
    }
    const wallet = requireRequestWallet(req);
    const result = await triggerAgent(agentId, wallet);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, result: result.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Trigger failed" },
      { status: 500 }
    );
  }
}
