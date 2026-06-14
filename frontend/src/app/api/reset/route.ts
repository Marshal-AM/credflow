import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

/** Delete Supabase cache (account_profiles + score_runs) for the env wallet. On-chain SBT is not removed. */
export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req).toLowerCase();
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase not configured — nothing to reset" },
        { status: 503 }
      );
    }

    const { error: profileErr } = await supabase
      .from("account_profiles")
      .delete()
      .eq("wallet_address", wallet);

    const { error: runsErr } = await supabase
      .from("score_runs")
      .delete()
      .eq("wallet_address", wallet);

    if (profileErr || runsErr) {
      return NextResponse.json(
        {
          error: profileErr?.message || runsErr?.message || "Reset failed",
        },
        { status: 500 }
      );
    }

    let reclaimSessionsRemoved = 0;
    try {
      const reclaimRes = await fetch(`${SCORING_API}/reclaim/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: wallet, require_reclaim: false }),
      });
      if (reclaimRes.ok) {
        const body = await reclaimRes.json();
        reclaimSessionsRemoved = Number(body.sessions_removed ?? 0);
      }
    } catch {
      /* ML API may be offline — Supabase reset still succeeded */
    }

    return NextResponse.json({
      ok: true,
      wallet,
      cleared: ["account_profiles", "score_runs"],
      reclaim_sessions_removed: reclaimSessionsRemoved,
      note: "On-chain SBT on Robinhood hub is unchanged — only Supabase cache was deleted.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reset failed" },
      { status: 500 }
    );
  }
}
