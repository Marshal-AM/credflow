import { NextRequest } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import {
  getSupabaseAdmin,
  profileFromScoreResponse,
} from "@/lib/supabase-server";
import { triggerSyncScore } from "@/lib/agent-client";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

async function persistScoreResult(
  wallet: string,
  data: Record<string, unknown>,
  require_reclaim: boolean,
  reclaim_session_id?: string
) {
  const supabase = getSupabaseAdmin();
  let supabaseSaved = false;
  let supabaseError: string | null = null;

  if (supabase) {
    const { error: runError } = await supabase.from("score_runs").insert({
      wallet_address: wallet.toLowerCase(),
      status: data.status || "unknown",
      require_reclaim,
      reclaim_session_id: (data.reclaim_session_id as string) || reclaim_session_id || null,
      response: data,
    });
    if (runError) supabaseError = runError.message;

    if (data.status === "complete") {
      const { error: profileError } = await supabase.from("account_profiles").upsert({
        ...profileFromScoreResponse(wallet, data, reclaim_session_id),
        mint_status: null,
      });
      if (profileError) {
        supabaseError = profileError.message;
      } else {
        supabaseSaved = true;
      }
    }
  }

  let lzSync = null;
  if (data.status === "complete" && typeof data.cred_score === "number") {
    lzSync = await triggerSyncScore(wallet, data.cred_score as number, "api_hook", "score_complete");
  }

  return { supabase_saved: supabaseSaved, supabase_error: supabaseError, lz_sync: lzSync };
}

export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const body = await req.json();
    const require_reclaim = Boolean(body.require_reclaim);
    const reuse_verified_reclaim = Boolean(body.reuse_verified_reclaim);
    const reclaim_session_id = body.reclaim_session_id as string | undefined;

    const upstream = await fetch(`${SCORING_API}/score/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: wallet,
        require_reclaim,
        reuse_verified_reclaim,
        reclaim_session_id,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: err.detail || "Scoring API error" }), {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!upstream.body) {
      return new Response(JSON.stringify({ error: "No stream body" }), { status: 502 });
    }

    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";
    let completePayload: Record<string, unknown> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";

            for (const chunk of chunks) {
              if (!chunk.trim()) continue;
              controller.enqueue(encoder.encode(`${chunk}\n\n`));

              const line = chunk.trim();
              if (!line.startsWith("data:")) continue;
              try {
                const parsed = JSON.parse(line.slice(5).trim()) as {
                  type: string;
                  data: Record<string, unknown>;
                };
                if (parsed.type === "complete") {
                  completePayload = parsed.data;
                }
              } catch {
                /* ignore */
              }
            }
          }

          if (completePayload?.status === "complete") {
            const extras = await persistScoreResult(
              wallet,
              completePayload,
              require_reclaim,
              reclaim_session_id
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "persisted", data: extras })}\n\n`)
            );
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Stream failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
