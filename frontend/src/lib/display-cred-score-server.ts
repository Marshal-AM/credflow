import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveDisplayCredScore } from "@/lib/display-cred-score";

/** Supabase-backed display score (matches dashboard resolution). */
export async function fetchDisplayCredScore(wallet: string): Promise<number | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const normalized = wallet.toLowerCase();

  const [{ data: profile }, { data: latestScoreRun }] = await Promise.all([
    supabase.from("account_profiles").select("*").eq("wallet_address", normalized).maybeSingle(),
    supabase
      .from("score_runs")
      .select("id, status, require_reclaim, reclaim_session_id, response, error_message, created_at")
      .eq("wallet_address", normalized)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return resolveDisplayCredScore({
    profile: profile as Record<string, unknown> | null,
    latestScoreRun: latestScoreRun as Record<string, unknown> | null,
  });
}
