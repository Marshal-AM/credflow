import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { fetchSbtMintTxHash } from "@/lib/sbt-chain";
import { triggerSyncScore } from "@/lib/agent-client";
import { writeApiHookRun } from "@/lib/run-file-log";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

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

    const res = await fetch(`${SCORING_API}/agents/underwrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: wallet,
        rescore: false,
        reclaim_session_id: reclaimSessionId,
        score_snapshot: scoreSnapshot,
        trigger_source: "api_hook",
        trigger_event: "sbt_mint",
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
      writeApiHookRun({
        hook: "mint",
        wallet,
        success: false,
        summary: reason,
        steps: [{ step: "underwriter", ok: false, error: reason }],
        error: reason,
      });
      return NextResponse.json({ error: reason, detail: data.detail }, { status: res.status });
    }

    let txHash = (data.tx as string | undefined) || null;
    if (!txHash) {
      txHash = await fetchSbtMintTxHash(wallet);
    }

    if (supabase) {
      await supabase
        .from("account_profiles")
        .update({
          mint_tx_hash: txHash,
          mint_status: "minted",
          minted_at: new Date().toISOString(),
          sbt_score_on_chain: data.cred_score ?? data.score,
          cred_score: data.cred_score ?? data.score,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", wallet.toLowerCase());
    }

    let lzSync = null;
    const score = (data.cred_score ?? data.score) as number | undefined;
    if (typeof score === "number" && score > 0) {
      lzSync = await triggerSyncScore(wallet, score, "api_hook", "sbt_mint");
    }

    writeApiHookRun({
      hook: "mint",
      wallet,
      success: true,
      summary: `minted cred_score=${data.cred_score ?? data.score}`,
      steps: [
        { step: "underwriter", ok: true, data: { onchain: data.onchain, tx: txHash } },
        { step: "lz_sync", ok: lzSync?.ok ?? false, error: lzSync?.error },
      ],
      payload: { cred_score: data.cred_score, tx: txHash, lz_sync: lzSync },
    });

    return NextResponse.json({ ...data, tx: txHash, mint_tx_hash: txHash, lz_sync: lzSync });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mint failed" },
      { status: 500 }
    );
  }
}
