"use client";

import type { ScoreResponse } from "@/lib/scoring-api";
import { applyOnChainScore } from "@/lib/score-display";
import { AccountScoreDetails } from "@/components/account/AccountScoreDetails";
import { LayerZeroSyncPanel } from "@/components/loans/LayerZeroSyncPanel";

type Props = {
  wallet: string;
  data: ScoreResponse;
  profile?: Record<string, unknown> | null;
  hasOnChainSbt: boolean;
  onChainScore?: number | null;
  hasCachedScore: boolean;
  onMint: () => void;
  onRescore: () => void;
  onResetCache: () => void;
  minting: boolean;
  resetting: boolean;
  mintError?: string | null;
  mintTx?: string | null;
  mintTxHash?: string | null;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function DataSourceBanner({
  hasCachedScore,
  hasOnChainSbt,
  lastScoredAt,
}: {
  hasCachedScore: boolean;
  hasOnChainSbt: boolean;
  lastScoredAt?: string | null;
}) {
  if (hasCachedScore) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
        ML feature breakdown from Supabase{" "}
        <code className="text-[11px]">account_profiles</code>
        {lastScoredAt ? ` (last scored ${new Date(lastScoredAt).toLocaleString()})` : ""}.
        CredScore shown above is the live on-chain SBT score when minted.
      </p>
    );
  }
  if (hasOnChainSbt) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        On-chain SBT exists but there is no cached ML score in Supabase — Sybil and feature data are
        missing until you run <strong>Build Your Score</strong> again.
      </p>
    );
  }
  return null;
}

export function AccountDashboard({
  wallet,
  data,
  profile,
  hasOnChainSbt,
  onChainScore,
  hasCachedScore,
  onMint,
  onRescore,
  onResetCache,
  minting,
  resetting,
  mintError,
  mintTx,
  mintTxHash,
}: Props) {
  const display = applyOnChainScore(data, onChainScore, hasOnChainSbt);
  const credScore =
    onChainScore ??
    (display.cred_score as number) ??
    (profile?.cred_score as number);
  const mlScore = display.ml_cred_score as number | undefined;
  const onChainFormula = display.on_chain_cred_score as number | undefined;
  const sybil = (data.sybil_details as Record<string, unknown>) || {};
  const pipeline = (data.pipeline as Record<string, unknown>) || {};
  const sybilRisk = data.sybil_risk as string | undefined;
  const displayMintTx =
    mintTx ||
    mintTxHash ||
    (profile?.mint_tx_hash as string | undefined) ||
    null;
  const minted =
    hasOnChainSbt ||
    profile?.mint_status === "minted" ||
    Boolean(mintTx);
  const approved = data.approved !== false && (profile?.approved as boolean) !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">Account (FRONTEND_PRIVATE_KEY)</p>
          <p className="mt-1 font-mono text-sm">{wallet}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRescore}
            className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400"
          >
            Rebuild score
          </button>
          <button
            type="button"
            disabled={resetting}
            onClick={onResetCache}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
          >
            {resetting ? "Resetting…" : "Reset Supabase cache"}
          </button>
        </div>
      </div>

      <DataSourceBanner
        hasCachedScore={hasCachedScore}
        hasOnChainSbt={hasOnChainSbt}
        lastScoredAt={profile?.last_scored_at as string | undefined}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="CredScore" value={credScore ?? "—"} />
        <Stat label="ML score" value={mlScore ?? "—"} />
        <Stat label="On-chain formula" value={onChainFormula ?? "—"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Borrow sub-score" value={(data.borrow_sub_score as number) ?? "—"} />
        <Stat label="Wallet sub-score" value={(data.wallet_sub_score as number) ?? "—"} />
      </div>

      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h3 className="font-semibold">Sybil analysis (R-GCN)</h3>
        <p className="mt-1 text-xs text-zinc-500">
          From ML API <code>sybil_risk</code> + <code>sybil_details</code> (graph model on tx
          counterparties).
        </p>
        <div className="mt-3 grid gap-2 text-sm">
          <p>
            <span className="text-zinc-500">Risk:</span>{" "}
            {sybilRisk ? (
              <strong
                className={
                  sybilRisk === "high"
                    ? "text-red-600"
                    : sybilRisk === "medium"
                      ? "text-amber-600"
                      : "text-emerald-600"
                }
              >
                {sybilRisk}
              </strong>
            ) : (
              <span className="text-zinc-400">— (not scored)</span>
            )}
          </p>
          <p>
            <span className="text-zinc-500">Method:</span>{" "}
            {sybil.method != null ? String(sybil.method) : "—"}
          </p>
          <p>
            <span className="text-zinc-500">Unique counterparties:</span>{" "}
            {sybil.unique_counterparties != null ? String(sybil.unique_counterparties) : "—"}
          </p>
          <p>
            <span className="text-zinc-500">Defaulter links:</span>{" "}
            {sybil.defaulter_links != null ? String(sybil.defaulter_links) : "—"}
          </p>
          {pipeline.sybil_analysis_ms != null && (
            <p className="text-xs text-zinc-400">
              Graph analysis completed in {String(pipeline.sybil_analysis_ms)}ms (parallel)
            </p>
          )}
        </div>
      </div>

      {hasCachedScore && <AccountScoreDetails data={display} />}

      {(data.balance_usd_cents as number) > 0 && (
        <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <h3 className="font-semibold">Bank balance (Reclaim)</h3>
          <p className="mt-2 text-sm">
            Verified USD capacity: ${((data.balance_usd_cents as number) / 100).toFixed(2)}
          </p>
        </div>
      )}

      {!approved && hasCachedScore && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          Not approved:{" "}
          {String(data.rejection_reason || profile?.rejection_reason || "Score or Sybil check failed")}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h3 className="font-semibold">Soulbound token</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Mint status: Supabase <code>mint_status</code> + live{" "}
          <code>hasProfile(wallet)</code> on Robinhood SBT contract. On-chain score from{" "}
          <code>getProfile</code>.
        </p>
        {minted ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-emerald-600">
              SBT minted on Robinhood hub
              {hasOnChainSbt ? " (confirmed on-chain)" : " (Supabase only — RPC read failed?)"}
            </p>
            {onChainScore != null && (
              <p>
                On-chain score: <strong>{onChainScore}</strong>
              </p>
            )}
            {displayMintTx ? (
              <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="text-xs font-medium text-zinc-500">Mint transaction hash</p>
                <p className="mt-1 font-mono text-xs break-all text-zinc-800 dark:text-zinc-200">
                  {displayMintTx}
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                Mint tx hash not found — refresh the page to load from chain.
              </p>
            )}
          </div>
        ) : approved || !hasCachedScore ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={minting || !hasCachedScore}
              onClick={onMint}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {minting ? "Minting…" : "Mint Soulbound Token"}
            </button>
            {!hasCachedScore && (
              <p className="mt-2 text-sm text-zinc-500">Run a score first before minting.</p>
            )}
            {mintError && <p className="mt-2 text-sm text-red-600">{mintError}</p>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Minting unavailable — score did not pass underwriting rules.
          </p>
        )}
      </div>

      {Boolean(data.shap_cid) && (
        <p className="text-xs text-zinc-400">SHAP IPFS: {String(data.shap_cid)}</p>
      )}

      <LayerZeroSyncPanel compact />
    </div>
  );
}
