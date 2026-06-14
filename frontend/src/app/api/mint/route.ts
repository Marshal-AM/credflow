import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { autoUnderwriteAfterScore, triggerSyncScore } from "@/lib/agent-client";

/** Legacy manual mint — scoring routes auto-mint/update after each complete run. */
export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
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

    if (!scoreSnapshot || scoreSnapshot.status !== "complete") {
      return NextResponse.json(
        { error: "Complete a score run before minting" },
        { status: 400 }
      );
    }

    const underwrite = await autoUnderwriteAfterScore(wallet, scoreSnapshot, {
      reclaimSessionId,
    });

    if (!underwrite.ok && !underwrite.skipped) {
      return NextResponse.json(
        { error: underwrite.error || "Underwrite failed" },
        { status: 400 }
      );
    }

    const credScore = underwrite.data?.cred_score as number | undefined;
    let lzSync = null;
    if (typeof credScore === "number" && credScore > 0) {
      lzSync = await triggerSyncScore(wallet, credScore, "api_hook", "sbt_mint");
    }

    return NextResponse.json({
      ...underwrite.data,
      mint_tx_hash: underwrite.data?.tx,
      lz_sync: lzSync,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mint failed" },
      { status: 500 }
    );
  }
}
