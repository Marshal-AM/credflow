import { NextRequest, NextResponse } from "next/server";
import { getFrontendAddress } from "@/lib/wallet-server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const wallet = getFrontendAddress();
    const body = await req.json().catch(() => ({}));
    const supabase = getSupabaseAdmin();

    let scoreSnapshot = body.score_snapshot as Record<string, unknown> | undefined;
    let reclaimSessionId: string | null = null;

    if (!scoreSnapshot && supabase) {
      const { data } = await supabase
        .from("account_profiles")
        .select("score_snapshot, reclaim_session_id")
        .eq("wallet_address", wallet.toLowerCase())
        .maybeSingle();
      scoreSnapshot = (data?.score_snapshot as Record<string, unknown>) || undefined;
      reclaimSessionId = data?.reclaim_session_id || null;
    }

    const res = await fetch(`${SCORING_API}/underwrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: wallet,
        rescore: false,
        reclaim_session_id: reclaimSessionId,
        score_snapshot: scoreSnapshot,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const reason =
        typeof data.detail === "object"
          ? data.detail.reason || JSON.stringify(data.detail)
          : data.detail || "Underwrite failed";
      if (supabase) {
        await supabase
          .from("account_profiles")
          .update({ mint_status: "failed", updated_at: new Date().toISOString() })
          .eq("wallet_address", wallet.toLowerCase());
      }
      return NextResponse.json({ error: reason, detail: data.detail }, { status: res.status });
    }

    if (supabase) {
      await supabase
        .from("account_profiles")
        .update({
          mint_tx_hash: data.tx || null,
          mint_status: "minted",
          minted_at: new Date().toISOString(),
          sbt_score_on_chain: data.cred_score ?? data.score,
          cred_score: data.cred_score ?? data.score,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", wallet.toLowerCase());
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mint failed" },
      { status: 500 }
    );
  }
}
