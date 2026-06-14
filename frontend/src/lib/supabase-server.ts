import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export type AccountProfileRow = {
  wallet_address: string;
  cred_score: number | null;
  ml_cred_score: number | null;
  on_chain_cred_score: number | null;
  default_prob_bps: number | null;
  balance_usd_cents: number | null;
  borrow_sub_score: number | null;
  wallet_sub_score: number | null;
  sybil_risk: string | null;
  sybil_details: Record<string, unknown> | null;
  model_breakdown: Record<string, unknown> | null;
  reclaim: Record<string, unknown> | null;
  approved: boolean | null;
  rejection_reason: string | null;
  shap_cid: string | null;
  reclaim_session_id: string | null;
  mint_tx_hash: string | null;
  mint_status: string | null;
  sbt_score_on_chain: number | null;
  score_snapshot: Record<string, unknown> | null;
  last_scored_at: string | null;
  minted_at: string | null;
  liquidation_snapshot: LiquidationSnapshot | null;
  updated_at: string | null;
};

export type LiquidationSnapshot = {
  borrower: string;
  blacklisted: string[];
  saved_at?: string;
};

export function profileFromScoreResponse(
  wallet: string,
  data: Record<string, unknown>,
  reclaimSessionId?: string | null
): Partial<AccountProfileRow> {
  return {
    wallet_address: wallet.toLowerCase(),
    cred_score: (data.cred_score as number) ?? null,
    ml_cred_score: (data.ml_cred_score as number) ?? null,
    on_chain_cred_score: (data.on_chain_cred_score as number) ?? null,
    default_prob_bps: (data.default_prob_bps as number) ?? null,
    balance_usd_cents: (data.balance_usd_cents as number) ?? null,
    borrow_sub_score: (data.borrow_sub_score as number) ?? null,
    wallet_sub_score: (data.wallet_sub_score as number) ?? null,
    sybil_risk: (data.sybil_risk as string) ?? null,
    sybil_details: (data.sybil_details as Record<string, unknown>) ?? null,
    model_breakdown: (data.model_breakdown as Record<string, unknown>) ?? null,
    reclaim: (data.reclaim as Record<string, unknown>) ?? null,
    approved: (data.approved as boolean) ?? null,
    rejection_reason: (data.rejection_reason as string) ?? null,
    shap_cid: (data.shap_cid as string) ?? null,
    reclaim_session_id: reclaimSessionId ?? (data.reclaim_session_id as string) ?? null,
    score_snapshot: data,
    last_scored_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
