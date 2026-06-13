"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DefaultTestStatus } from "@/lib/test-default-server";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";
import { toast } from "@/lib/toast";

type StepLog = {
  step: string;
  at: string;
  ok: boolean;
  message: string;
  txs: string[];
};

function bpsToPct(bps: number | null): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

function TxProof({ txs }: { txs: string[] }) {
  if (!txs.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs break-all text-emerald-400 font-mono">
      {txs.map((tx) => (
        <li key={tx}>
          <code>{tx}</code>
        </li>
      ))}
    </ul>
  );
}

export function TestDefaultTab() {
  const { address, isConnected, isConnecting, apiFetch } = useWalletApi();
  const [status, setStatus] = useState<DefaultTestStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [crashPrice, setCrashPrice] = useState("200");
  const [logs, setLogs] = useState<StepLog[]>([]);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await apiFetch("/api/test-default/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setStatus(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Load failed", "test-default-load");
    }
  }, [address, apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runStep(
    step: string,
    body: Record<string, unknown> = {},
    label?: string
  ) {
    setBusy(step);
    try {
      const res = await apiFetch("/api/test-default/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Step failed");

      const r = data.result as Record<string, unknown>;
      const crash = r.oracle_crash as Record<string, unknown> | undefined;
      const txs = [
        r.set_price_tx,
        crash?.set_price_tx,
        r.health_warning_tx,
        r.liquidate_tx,
        r.blacklist_tx,
        r.unblacklist_tx,
        ...(Array.isArray(r.lz_broadcast_tx)
          ? r.lz_broadcast_tx.map((t: { tx_hash?: string }) => t.tx_hash)
          : []),
      ].filter((t): t is string => typeof t === "string");

      setLogs((prev) => [
        {
          step: label || step,
          at: new Date().toLocaleString(),
          ok: true,
          message:
            data.step === "liquidate"
              ? [
                  String(r.status ?? "done"),
                  crash?.crashed
                    ? `oracle ${crash.previous_eth_price_usd}→${crash.target_eth_price_usd} USD · LTV ${crash.ltv_before_bps}→${crash.ltv_after_bps} bps`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Success",
          txs,
        },
        ...prev,
      ]);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setLogs((prev) => [
        { step: label || step, at: new Date().toLocaleString(), ok: false, message: msg, txs: [] },
        ...prev,
      ]);
      toast.error(msg, `test-default-${step}`);
    } finally {
      setBusy(null);
    }
  }

  const loanId = status?.hub.loanId ? Number(status.hub.loanId) : null;

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to run the default test flow" />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="card-padded">
        <h3 className="text-lg font-[650]">Alternate ending — Maya defaults</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Follows{" "}
          <span className="font-[650]">docs/userStory.md</span> steps 5–6: portfolio monitor
          health warning → covenant breach / grace → liquidation → LayerZero default broadcast →
          optional whitelist via <code className="font-mono">removeFromBlacklist</code> on the SBT
          (agents replace OZ Defender).
        </p>
        <p className="mt-2 text-xs text-subtle">
          Prerequisite: active hub loan. Run{" "}
          <code className="font-mono">npm run ml:serve</code> and{" "}
          <code className="font-mono">npm run agents:serve</code> for full flow.
        </p>
      </div>

      <section className="card-padded">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="font-[650]">Live state</h4>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-primary hover:underline"
          >
            Refresh
          </button>
        </div>
        {status ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="section-label">Hub loan</dt>
              <dd className="mt-1">{status.hub.loanActive ? `#${status.hub.loanId}` : "None"}</dd>
            </div>
            <div>
              <dt className="section-label">LTV / liquidation at</dt>
              <dd className="mt-1">
                {bpsToPct(status.hub.ltvBps)} / {bpsToPct(status.hub.liquidationThresholdBps)}
                {status.ready.liquidatable ? " ✓ liquidatable" : ""}
              </dd>
            </div>
            <div>
              <dt className="section-label">Due</dt>
              <dd className="mt-1">
                {status.hub.dueTime ?? "—"}
                {status.hub.overdue ? " (overdue)" : ""}
              </dd>
            </div>
            <div>
              <dt className="section-label">Hub score / defaults</dt>
              <dd className="mt-1">
                {status.hub.score} · defaultCount={status.hub.defaultCount}
              </dd>
            </div>
            <div>
              <dt className="section-label">Hub blacklist</dt>
              <dd className="mt-1">{status.hub.hubBlacklisted ? "Yes" : "No"}</dd>
            </div>
            {status.spokes.map((s) => (
              <div key={s.chainKey}>
                <dt className="section-label">{s.label} LZ</dt>
                <dd className="mt-1">
                  score {s.score}
                  {s.lzBlacklisted ? " · blacklisted" : ""}
                  {s.lzLoanActive ? " · loan mirror" : ""}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </section>

      <StepCard
        n={1}
        title="ETH price shock (day 14)"
        desc="Crash the hub mock Chainlink feed so collateral value drops and LTV rises (user story: ETH −18%, LTV ~73%). Lower further until LTV ≥ 85% before liquidation."
        disabled={!status?.ready.hasActiveLoan || busy !== null}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="section-label">ETH price (USD)</span>
            <input
              type="number"
              value={crashPrice}
              onChange={(e) => setCrashPrice(e.target.value)}
              className="input-field mt-1.5 w-32"
            />
          </label>
          <button
            type="button"
            disabled={busy === "crash_oracle"}
            onClick={() =>
              void runStep("crash_oracle", { eth_price_usd: Number(crashPrice) }, "Crash oracle")
            }
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-[650] text-black transition-spring hover:scale-[1.03] disabled:opacity-50"
          >
            {busy === "crash_oracle" ? "Crashing…" : "1. Crash ETH price"}
          </button>
        </div>
      </StepCard>

      <StepCard
        n={2}
        title="Portfolio monitor — health warning"
        desc="Portfolio Monitor Agent emits on-chain HealthWarning (replaces Defender cron). Runs at ≥75% LTV or after price crash."
        disabled={!loanId || busy !== null}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === "health_warning"}
            onClick={() =>
              void runStep("health_warning", { loan_id: loanId }, "Health warning")
            }
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-[650] text-white transition-spring hover:scale-[1.03] disabled:opacity-50"
          >
            {busy === "health_warning" ? "Emitting…" : "2a. Emit HealthWarning"}
          </button>
          <button
            type="button"
            disabled={busy === "portfolio_monitor"}
            onClick={() => void runStep("portfolio_monitor", {}, "Portfolio monitor")}
            className="btn-secondary"
          >
            {busy === "portfolio_monitor" ? "Scanning…" : "2b. Run monitor sweep"}
          </button>
        </div>
      </StepCard>

      <StepCard
        n={3}
        title="Covenant breach — 48h grace"
        desc="Day 31: loan overdue, no repayment. Agent starts grace (in-memory; user story soft recovery). Test button expires grace immediately."
        disabled={!loanId || busy !== null}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === "grace_start"}
            onClick={() => void runStep("grace_start", { loan_id: loanId }, "Covenant breach")}
            className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-[650] text-white transition-spring hover:scale-[1.03] disabled:opacity-50"
          >
            {busy === "grace_start" ? "Starting…" : "3a. Start grace (covenant breach)"}
          </button>
          <button
            type="button"
            disabled={busy === "grace_expire"}
            onClick={() => void runStep("grace_expire", { loan_id: loanId }, "Expire grace")}
            className="rounded-xl border border-violet-400/30 px-4 py-2 text-sm text-violet-300 transition-spring hover:scale-[1.02] disabled:opacity-50"
          >
            {busy === "grace_expire" ? "Expiring…" : "3b. Expire grace (test)"}
          </button>
        </div>
      </StepCard>

      <StepCard
        n={4}
        title="Liquidation + LayerZero default"
        desc="Liquidation Agent: if LTV is below 85%, auto-crashes the ETH oracle first, then liquidates, records default, and broadcasts score 310 to spokes via LayerZero."
        disabled={!loanId || busy !== null}
      >
        <button
          type="button"
          disabled={busy === "liquidate"}
          onClick={() =>
            void runStep(
              "liquidate",
              { loan_id: loanId, force_grace: true },
              "Liquidate + LZ default"
            )
          }
          className="rounded-xl bg-red-500 px-4 py-2 text-sm font-[650] text-white transition-spring hover:scale-[1.03] disabled:opacity-50"
        >
          {busy === "liquidate" ? "Liquidating…" : "4. Liquidate (after grace)"}
        </button>
        {!status?.ready.liquidatable && status?.ready.hasActiveLoan && (
          <p className="mt-2 text-xs text-muted-foreground">
            LTV is below {bpsToPct(status.hub.liquidationThresholdBps)} — step 4 will auto-crash the
            oracle to make the loan liquidatable before sending the liquidate tx.
          </p>
        )}
      </StepCard>

      <StepCard
        n={5}
        title="Whitelist wallet (post-test)"
        desc="Calls SBT removeFromBlacklist via agent (AGENT_ROLE). Clears hub blacklist so you can test again. Note: defaultCount on SBT is not reset by this."
        disabled={busy !== null}
      >
        <button
          type="button"
          disabled={busy === "unblacklist"}
          onClick={() => void runStep("unblacklist", {}, "Whitelist / unblacklist")}
          className="btn-primary disabled:opacity-50"
        >
          {busy === "unblacklist" ? "Whitelisting…" : "5. Whitelist my wallet"}
        </button>
      </StepCard>

      {logs.length > 0 && (
        <section className="card-padded">
          <h4 className="mb-4 font-[650]">Transaction log</h4>
          <ul className="space-y-3">
            {logs.map((log, i) => (
              <li
                key={`${log.step}-${log.at}-${i}`}
                className={`rounded-xl border p-3 text-sm ${
                  log.ok
                    ? "border-emerald-400/20 bg-emerald-400/5"
                    : "border-red-400/20 bg-red-400/5"
                }`}
              >
                <p className="font-[650]">
                  {log.ok ? "✓" : "✗"} {log.step}{" "}
                  <span className="font-normal text-muted-foreground">· {log.at}</span>
                </p>
                <p className="text-muted-foreground">{log.message}</p>
                <TxProof txs={log.txs} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StepCard({
  n,
  title,
  desc,
  disabled,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`card-padded transition-spring ${disabled ? "opacity-60" : "hover:border-primary/20"}`}>
      <p className="section-label">Step {n}</p>
      <h4 className="mt-1 font-[650]">{title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
