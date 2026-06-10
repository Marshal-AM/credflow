"use client";

import type { ScoreResponse } from "@/lib/scoring-api";

type Props = {
  wallet: string;
  data: ScoreResponse;
  profile?: Record<string, unknown> | null;
  hasOnChainSbt: boolean;
  onChainScore?: number | null;
  onMint: () => void;
  minting: boolean;
  mintError?: string | null;
  mintTx?: string | null;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

export function AccountDashboard({
  wallet,
  data,
  profile,
  hasOnChainSbt,
  onChainScore,
  onMint,
  minting,
  mintError,
  mintTx,
}: Props) {
  const credScore = (data.cred_score as number) ?? (profile?.cred_score as number);
  const sybil = (data.sybil_details as Record<string, unknown>) || {};
  const pipeline = (data.pipeline as Record<string, unknown>) || {};
  const minted =
    hasOnChainSbt ||
    profile?.mint_status === "minted" ||
    Boolean(mintTx);
  const approved = data.approved !== false && (profile?.approved as boolean) !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <p className="text-xs text-zinc-500">Account</p>
        <p className="mt-1 font-mono text-sm">{wallet}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="CredScore" value={credScore ?? "—"} />
        <Stat label="ML score" value={(data.ml_cred_score as number) ?? "—"} />
        <Stat
          label="On-chain formula"
          value={(data.on_chain_cred_score as number) ?? credScore ?? "—"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Borrow sub-score" value={(data.borrow_sub_score as number) ?? "—"} />
        <Stat label="Wallet sub-score" value={(data.wallet_sub_score as number) ?? "—"} />
      </div>

      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h3 className="font-semibold">Sybil analysis (R-GCN)</h3>
        <div className="mt-3 grid gap-2 text-sm">
          <p>
            <span className="text-zinc-500">Risk:</span>{" "}
            <strong
              className={
                data.sybil_risk === "high"
                  ? "text-red-600"
                  : data.sybil_risk === "medium"
                    ? "text-amber-600"
                    : "text-emerald-600"
              }
            >
              {String(data.sybil_risk || "low")}
            </strong>
          </p>
          <p>
            <span className="text-zinc-500">Method:</span> {String(sybil.method || "—")}
          </p>
          <p>
            <span className="text-zinc-500">Unique counterparties:</span>{" "}
            {String(sybil.unique_counterparties ?? "—")}
          </p>
          <p>
            <span className="text-zinc-500">Defaulter links:</span>{" "}
            {String(sybil.defaulter_links ?? 0)}
          </p>
          {pipeline.sybil_analysis_ms != null && (
            <p className="text-xs text-zinc-400">
              Graph analysis completed in {String(pipeline.sybil_analysis_ms)}ms (parallel)
            </p>
          )}
        </div>
      </div>

      {(data.balance_usd_cents as number) > 0 && (
        <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <h3 className="font-semibold">Bank balance (Reclaim)</h3>
          <p className="mt-2 text-sm">
            Verified USD capacity: ${((data.balance_usd_cents as number) / 100).toFixed(2)}
          </p>
        </div>
      )}

      {!approved && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          Not approved: {String(data.rejection_reason || profile?.rejection_reason || "Score or Sybil check failed")}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h3 className="font-semibold">Soulbound token</h3>
        {minted ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-emerald-600">SBT minted on Robinhood hub</p>
            {onChainScore != null && (
              <p>On-chain score: <strong>{onChainScore}</strong></p>
            )}
            {mintTx && (
              <p className="font-mono text-xs break-all text-zinc-500">Tx: {mintTx}</p>
            )}
            {Boolean(profile?.mint_tx_hash) && !mintTx && (
              <p className="font-mono text-xs break-all text-zinc-500">
                Tx: {String(profile?.mint_tx_hash)}
              </p>
            )}
          </div>
        ) : approved ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={minting}
              onClick={onMint}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {minting ? "Minting…" : "Mint Soulbound Token"}
            </button>
            {mintError && (
              <p className="mt-2 text-sm text-red-600">{mintError}</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Minting unavailable — score did not pass underwriting rules.
          </p>
        )}
      </div>

      {Boolean(data.shap_cid) && (
        <p className="text-xs text-zinc-400">SHAP explanation: {String(data.shap_cid)}</p>
      )}
    </div>
  );
}
