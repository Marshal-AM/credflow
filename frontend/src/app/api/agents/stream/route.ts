import { requireRequestWallet } from "@/lib/wallet-request";
import { loadAgentRunsFromFiles } from "@/lib/agent-run-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events: live agent run logs from logs/agent-runs (no Supabase). */
export async function GET(req: Request) {
  const wallet = requireRequestWallet(req);
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id") || undefined;

  const encoder = new TextEncoder();
  let closed = false;
  let lastPayload = "";

  const stream = new ReadableStream({
    start(controller) {
      const push = () => {
        if (closed) return;
        try {
          const { runs, logs, sessionDir } = loadAgentRunsFromFiles({
            wallet,
            agentId,
            runLimit: 40,
            logLimit: 150,
          });
          const payload = JSON.stringify({
            wallet,
            runs,
            logs,
            sessionDir,
            at: new Date().toISOString(),
          });
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "log read failed";
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
        }
      };

      push();
      const interval = setInterval(push, 1500);

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
