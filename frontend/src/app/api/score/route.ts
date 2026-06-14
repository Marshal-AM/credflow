import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import {
  getSupabaseAdmin,
  profileFromScoreResponse,
} from "@/lib/supabase-server";
import { triggerSyncScore } from "@/lib/agent-client";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const body = await req.json();
    const require_reclaim = Boolean(body.require_reclaim);
    const reuse_verified_reclaim = Boolean(body.reuse_verified_reclaim);
    const reclaim_session_id = body.reclaim_session_id as string | undefined;

    const res = await fetch(`${SCORING_API}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: wallet,
        require_reclaim,
        reuse_verified_reclaim,
        reclaim_session_id,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || "Scoring API error" },
        { status: res.status }
      );
    }

    const supabase = getSupabaseAdmin();
    let supabaseSaved = false;
    let supabaseError: string | null = null;

    if (supabase) {
      const { error: runError } = await supabase.from("score_runs").insert({
        wallet_address: wallet.toLowerCase(),
        status: data.status || "unknown",
        require_reclaim,
        reclaim_session_id: data.reclaim_session_id || reclaim_session_id || null,
        response: data,
      });
      if (runError) {
        supabaseError = runError.message;
      }

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
      lzSync = await triggerSyncScore(wallet, data.cred_score, "api_hook", "score_complete");
    }

    return NextResponse.json({
      ...data,
      supabase_saved: supabaseSaved,
      supabase_error: supabaseError,
      lz_sync: lzSync,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Score request failed" },
      { status: 500 }
    );
  }
}
