"use client";

import { useCallback, useEffect, useState } from "react";
import type { PrepWalletStepId } from "@/lib/prep-wallet-server";

type StepInfo = {
  id: PrepWalletStepId;
  label: string;
  description: string;
  network: string;
  order: number;
};

type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

type StepLog = {
  id: PrepWalletStepId;
  label: string;
  status: StepStatus;
  message: string;
  txs: string[];
  durationMs?: number;
  at: string;
};

type PrepStatus = {
  wallet: string;
  steps: StepInfo[];
};

const EXPLORER: Record<string, string> = {
  arbitrumSepolia: "https://sepolia.arbiscan.io/tx/",
  baseSepolia: "https://sepolia.basescan.org/tx/",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusBadge(status: StepStatus) {
  const styles: Record<StepStatus, string> = {
    pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    running: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    error: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
    skipped: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
  };
  const labels: Record<StepStatus, string> = {
    pending: "Pending",
    running: "Running…",
    done: "Done",
    error: "Failed",
    skipped: "Skipped",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export function PrepWalletTab() {
  const [status, setStatus] = useState<PrepStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepping, setPrepping] = useState(false);
  const [runMode, setRunMode] = useState<"all" | "single" | null>(null);
  const [currentStep, setCurrentStep] = useState<PrepWalletStepId | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<PrepWalletStepId | null>(null);
  const [stepStates, setStepStates] = useState<Record<PrepWalletStepId, StepStatus>>({} as Record<PrepWalletStepId, StepStatus>);
  const [logs, setLogs] = useState<StepLog[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/prep-wallet/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setStatus(data);
      setError(null);
      setSelectedStepId((prev) => {
        if (prev) return prev;
        const steps = (data.steps as StepInfo[]).sort((a, b) => a.order - b.order);
        return steps[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runStep(step: StepInfo): Promise<boolean> {
    setCurrentStep(step.id);
    setStepStates((s) => ({ ...s, [step.id]: "running" }));

    try {
      const res = await fetch("/api/prep-wallet/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: step.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Step failed");

      const result = data.result as {
        txs?: string[];
        txCount?: number | null;
        durationMs?: number;
      };
      const txList = result.txs ?? [];
      const txCount = result.txCount ?? txList.length;
      setStepStates((s) => ({ ...s, [step.id]: "done" }));
      setLogs((prev) => [
        {
          id: step.id,
          label: step.label,
          status: "done",
          message: `Completed in ${formatDuration(result.durationMs ?? 0)} · ${txCount} transaction${txCount === 1 ? "" : "s"}`,
          txs: txList,
          durationMs: result.durationMs,
          at: new Date().toLocaleString(),
        },
        ...prev,
      ]);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Step failed";
      setStepStates((s) => ({ ...s, [step.id]: "error" }));
      setLogs((prev) => [
        {
          id: step.id,
          label: step.label,
          status: "error",
          message: msg,
          txs: [],
          at: new Date().toLocaleString(),
        },
        ...prev,
      ]);
      setError(msg);
      return false;
    } finally {
      setCurrentStep(null);
    }
  }

  async function performSelected() {
    if (!selectedStepId || prepping) return;
    const step = status?.steps.find((s) => s.id === selectedStepId);
    if (!step) return;

    setPrepping(true);
    setRunMode("single");
    setError(null);
    await runStep(step);
    setPrepping(false);
    setRunMode(null);
  }

  async function runAll() {
    if (!status?.steps.length || prepping) return;

    setPrepping(true);
    setRunMode("all");
    setError(null);
    setLogs([]);

    const reset: Record<PrepWalletStepId, StepStatus> = {} as Record<PrepWalletStepId, StepStatus>;
    for (const step of status.steps) {
      reset[step.id] = "pending";
    }
    setStepStates(reset);

    const ordered = [...status.steps].sort((a, b) => a.order - b.order);
    for (const step of ordered) {
      const ok = await runStep(step);
      if (!ok) break;
    }

    setPrepping(false);
    setRunMode(null);
  }

  const orderedSteps = status?.steps ? [...status.steps].sort((a, b) => a.order - b.order) : [];
  const selectedStep = orderedSteps.find((s) => s.id === selectedStepId);
  const doneCount = orderedSteps.filter((s) => stepStates[s.id] === "done").length;
  const allDone = orderedSteps.length > 0 && doneCount === orderedSteps.length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold">Prep wallet for scoring</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Runs on-chain activity scripts one by one to populate scoring features: simple transfers,
          Aave borrow/repay on Arbitrum and Base Sepolia, and a Morpho Blue cycle. Uses your dev
          wallet from <code className="text-zinc-700 dark:text-zinc-300">FRONTEND_PRIVATE_KEY</code>.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Wallet:{" "}
          <code className="text-zinc-700 dark:text-zinc-300">{status?.wallet ?? "…"}</code>. Fund it
          on Arbitrum Sepolia and Base Sepolia before running. A 10s pause is added after each
          confirmed tx to avoid RPC in-flight limits. Each step may take several minutes.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </p>
      )}

      {allDone && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          Wallet prep complete. Wait 30–90 minutes for indexers, then rebuild your score from Your
          Account.
        </p>
      )}

      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-medium">Prep steps</h4>
            <p className="text-xs text-zinc-500">
              {doneCount}/{orderedSteps.length} completed · select one step, then Perform
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={prepping || !selectedStepId}
              onClick={() => void performSelected()}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              {prepping && runMode === "single" ? "Performing…" : "Perform"}
            </button>
            <button
              type="button"
              disabled={prepping || !status}
              onClick={() => void runAll()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {prepping && runMode === "all" ? "Running all…" : "Run all"}
            </button>
          </div>
        </div>

        {selectedStep && (
          <p className="mb-3 text-xs text-zinc-500">
            Selected: <span className="font-medium text-zinc-700 dark:text-zinc-300">{selectedStep.label}</span>
          </p>
        )}

        <ul className="space-y-3">
          {orderedSteps.map((step) => {
            const state = stepStates[step.id] ?? "pending";
            const isActive = currentStep === step.id;
            const isSelected = selectedStepId === step.id;
            return (
              <li key={step.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    isActive
                      ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                      : isSelected
                        ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20"
                        : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="prep-step"
                    value={step.id}
                    checked={isSelected}
                    disabled={prepping}
                    onChange={() => setSelectedStepId(step.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {step.order}. {step.label}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">{step.description}</p>
                    <p className="mt-1 text-xs text-zinc-400">Network: {step.network}</p>
                  </div>
                  {statusBadge(isActive ? "running" : state)}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {logs.length > 0 && (
        <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h4 className="mb-3 font-medium">Run log</h4>
          <ul className="space-y-4">
            {logs.map((log, i) => {
              const step = orderedSteps.find((s) => s.id === log.id);
              const explorer = step ? EXPLORER[step.network] : undefined;
              return (
                <li
                  key={`${log.id}-${i}`}
                  className="rounded-lg border border-zinc-100 px-4 py-3 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{log.label}</p>
                    {statusBadge(log.status)}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{log.at}</p>
                  <p
                    className={`mt-1 text-sm ${
                      log.status === "error"
                        ? "text-red-700 dark:text-red-300"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {log.message}
                  </p>
                  {log.txs.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs break-all">
                      {log.txs.map((tx) => (
                        <li key={tx}>
                          {explorer ? (
                            <a
                              href={`${explorer}${tx}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 hover:underline dark:text-emerald-300"
                            >
                              {tx}
                            </a>
                          ) : (
                            <code>{tx}</code>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
