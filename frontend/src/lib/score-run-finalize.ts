import {
  autoUnderwriteAfterScore,
  triggerSyncScore,
  type AutoUnderwriteResult,
} from "@/lib/agent-client";
import { scoreMeetsUnderwriteCriteria, underwriteTargetScore } from "@/lib/score-display";
import { getSupabaseAdmin, profileFromScoreResponse } from "@/lib/supabase-server";

export type ScoreRunFinalizeResult = {
  supabase_saved: boolean;
  supabase_error: string | null;
  underwrite: AutoUnderwriteResult;
  lz_sync: Awaited<ReturnType<typeof triggerSyncScore>> | null;
};

/** Persist score, auto mint/update SBT, then LZ-sync the on-chain score. */
export async function finalizeCompleteScoreRun(
  wallet: string,
  data: Record<string, unknown>,
  options: {
    require_reclaim: boolean;
    reclaim_session_id?: string;
  }
): Promise<ScoreRunFinalizeResult> {
  const supabase = getSupabaseAdmin();
  let supabaseSaved = false;
  let supabaseError: string | null = null;

  if (supabase) {
    const { error: runError } = await supabase.from("score_runs").insert({
      wallet_address: wallet.toLowerCase(),
      status: data.status || "unknown",
      require_reclaim: options.require_reclaim,
      reclaim_session_id:
        (data.reclaim_session_id as string) || options.reclaim_session_id || null,
      response: data,
    });
    if (runError) supabaseError = runError.message;

    if (data.status === "complete") {
      const { error: profileError } = await supabase.from("account_profiles").upsert({
        ...profileFromScoreResponse(wallet, data, options.reclaim_session_id),
      });
      if (profileError) {
        supabaseError = profileError.message;
      } else {
        supabaseSaved = true;
      }
    }
  }

  let underwrite: AutoUnderwriteResult = { ok: false, skipped: true, reason: "score_incomplete" };
  let lzSync: Awaited<ReturnType<typeof triggerSyncScore>> | null = null;

  if (data.status === "complete") {
    underwrite = await autoUnderwriteAfterScore(wallet, data, {
      reclaimSessionId:
        (data.reclaim_session_id as string) || options.reclaim_session_id || null,
    });

    const lzScore =
      typeof underwrite.data?.cred_score === "number"
        ? underwrite.data.cred_score
        : underwriteTargetScore(data);

    if (lzScore != null && lzScore > 0 && scoreMeetsUnderwriteCriteria(data)) {
      const triggerEvent =
        underwrite.data?.onchain === "mintSBT" || underwrite.data?.onchain === "mintScore"
          ? "score_mint"
          : underwrite.data?.onchain === "updateScore" || underwrite.data?.onchain === "mintScore"
            ? "score_rescore"
            : underwrite.skipped
              ? "score_complete"
              : "score_rescore";
      lzSync = await triggerSyncScore(wallet, lzScore, "api_hook", triggerEvent);
    }
  }

  return {
    supabase_saved: supabaseSaved,
    supabase_error: supabaseError,
    underwrite,
    lz_sync: lzSync,
  };
}
