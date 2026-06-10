import { NextRequest, NextResponse } from "next/server";
import { getFrontendAddress } from "@/lib/wallet-server";
import {
  getSupabaseAdmin,
  profileFromScoreResponse,
} from "@/lib/supabase-server";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const wallet = getFrontendAddress();
    const body = await req.json();
    const require_reclaim = Boolean(body.require_reclaim);
    const reclaim_session_id = body.reclaim_session_id as string | undefined;

    const res = await fetch(`${SCORING_API}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: wallet,
        require_reclaim,
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
    if (supabase) {
      await supabase.from("score_runs").insert({
        wallet_address: wallet.toLowerCase(),
        status: data.status || "unknown",
        require_reclaim,
        reclaim_session_id: data.reclaim_session_id || reclaim_session_id || null,
        response: data,
      });

      if (data.status === "complete") {
        await supabase.from("account_profiles").upsert({
          ...profileFromScoreResponse(wallet, data, reclaim_session_id),
          mint_status: null,
        });
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Score request failed" },
      { status: 500 }
    );
  }
}
