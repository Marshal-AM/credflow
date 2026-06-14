import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { finalizeCompleteScoreRun } from "@/lib/score-run-finalize";
import { getSupabaseAdmin } from "@/lib/supabase-server";

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

    let extras = null;
    if (data.status === "complete") {
      extras = await finalizeCompleteScoreRun(wallet, data, {
        require_reclaim,
        reclaim_session_id,
      });
    } else {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        await supabase.from("score_runs").insert({
          wallet_address: wallet.toLowerCase(),
          status: data.status || "unknown",
          require_reclaim,
          reclaim_session_id: data.reclaim_session_id || reclaim_session_id || null,
          response: data,
        });
      }
    }

    return NextResponse.json({
      ...data,
      ...(extras ?? {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Score request failed" },
      { status: 500 }
    );
  }
}
