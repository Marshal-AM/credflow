-- CredFlow frontend cache — run in Supabase SQL editor
--
-- Existing projects: add liquidation graph cache
-- alter table account_profiles add column if not exists liquidation_snapshot jsonb;

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
  liquidation_snapshot jsonb,
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

-- LayerZero broadcast audit trail (hub + per-destination txs)
create table if not exists layerzero_broadcasts (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  trigger_source text not null,
  message_type text not null,
  hub_score int,
  status text not null default 'submitted',
  hub_tx_hashes jsonb not null default '[]',
  related_onchain_tx text,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists lz_broadcasts_wallet_idx
  on layerzero_broadcasts (wallet_address, created_at desc);

create table if not exists loan_events (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  chain_key text not null,
  loan_id bigint,
  event_type text not null,
  borrow_amount numeric,
  collateral_amount numeric,
  borrow_token text,
  tx_hash text not null,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists loan_events_wallet_chain_idx
  on loan_events (wallet_address, chain_key, created_at desc);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  wallet_address text,
  trigger_source text not null,
  trigger_event text,
  status text not null default 'running',
  started_at timestamptz default now(),
  finished_at timestamptz,
  duration_ms int,
  summary text,
  result jsonb,
  related_tx_hashes jsonb default '[]',
  related_lz_broadcast_id uuid references layerzero_broadcasts(id),
  created_at timestamptz default now()
);

create index if not exists agent_runs_agent_idx
  on agent_runs (agent_id, created_at desc);

create index if not exists agent_runs_wallet_idx
  on agent_runs (wallet_address, created_at desc);

create table if not exists agent_log_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  logged_at timestamptz default now(),
  level text not null default 'info',
  message text not null,
  metadata jsonb
);

create index if not exists agent_log_lines_run_idx
  on agent_log_lines (run_id, logged_at asc);
