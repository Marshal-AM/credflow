import { requireRequestWallet } from "@/lib/wallet-request";
import { loadAgentRuns } from "@/lib/agent-runs";
import { mapAgentsFromRuns } from "@/components/agents/agent-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: polls Supabase agent_runs + agent_log_lines for live updates. */
export async function GET(req: Request) {
  const wallet = requireRequestWallet(req);
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id") || undefined;

  const encoder = new TextEncoder();
  let closed = false;
  let lastPayload = "";

  const stream = new ReadableStream({
    start(controller) {
      const push = async () => {
        if (closed) return;
        try {
          const { runs, logs } = await loadAgentRuns({
            wallet,
            agentId,
            runLimit: 50,
            logLimit: 2000,
          });
          const payload = JSON.stringify({
            wallet,
            agents: mapAgentsFromRuns(runs),
            runs,
            logs,
            source: "supabase",
            at: new Date().toISOString(),
          });
          const hasRunning = runs.some((r) => r.status === "running");
          if (hasRunning || payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "log read failed";
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`)
          );
        }
      };

      void push();
      const interval = setInterval(() => void push(), 1500);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
