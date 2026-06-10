-- CredFlow frontend cache — run in Supabase SQL editor

create table if not exists account_profiles (
  wallet_address text primary key,
  cred_score int,
  ml_cred_score int,
  on_chain_cred_score int,
  default_prob_bps int,
  balance_usd_cents int,
  borrow_sub_score int,
  wallet_sub_score int,
  sybil_risk text,
  sybil_details jsonb,
  model_breakdown jsonb,
  reclaim jsonb,
  approved boolean,
  rejection_reason text,
  shap_cid text,
  reclaim_session_id text,
  mint_tx_hash text,
  mint_status text,
  sbt_score_on_chain int,
  score_snapshot jsonb,
  last_scored_at timestamptz,
  minted_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists score_runs (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  status text not null,
  require_reclaim boolean default false,
  reclaim_session_id text,
  response jsonb,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists score_runs_wallet_idx on score_runs (wallet_address, created_at desc);
