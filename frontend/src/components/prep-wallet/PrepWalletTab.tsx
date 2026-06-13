"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import {
  PREP_WALLET_STEPS,
  runPrepWalletStep,
  type PrepWalletStepId,
} from "@/lib/prep-wallet-client";
import { chainLogoSrc } from "@/lib/chain-logos";
import { chainIdByKey } from "@/lib/chains";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";
import { toast } from "@/lib/toast";

type StepStatus = "pending" | "running" | "done" | "error";

function networkLogo(network: "arbitrum" | "base"): string {
  return network === "arbitrum" ? chainLogoSrc("arbitrum") : chainLogoSrc("base");
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StepBadge({ status }: { status: StepStatus }) {
  const label =
    status === "running" ? "Running" : status === "done" ? "Done" : status === "error" ? "Failed" : "Pending";
  return (
    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-[650] uppercase tracking-wider text-primary">
      {label}
    </span>
  );
}

export function PrepWalletTab() {
  const { isConnected, isConnecting } = useWalletApi();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  const [prepping, setPrepping] = useState(false);
  const [currentStep, setCurrentStep] = useState<PrepWalletStepId | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<PrepWalletStepId>(PREP_WALLET_STEPS[0].id);
  const [stepStates, setStepStates] = useState<Record<PrepWalletStepId, StepStatus>>(
    {} as Record<PrepWalletStepId, StepStatus>
  );
  const [lastLog, setLastLog] = useState<string | null>(null);

  const ensureChain = useCallback(
    async (network: "arbitrum" | "base") => {
      const chainId = chainIdByKey[network === "arbitrum" ? "arbitrum" : "base"];
      await switchChainAsync({ chainId });
      return chainId;
    },
    [switchChainAsync]
  );

  const orderedSteps = [...PREP_WALLET_STEPS].sort((a, b) => a.order - b.order);
  const doneCount = orderedSteps.filter((s) => stepStates[s.id] === "done").length;
  const allDone = orderedSteps.length > 0 && doneCount === orderedSteps.length;

  async function runStep(stepId: PrepWalletStepId): Promise<boolean> {
    if (!address || !publicClient || !sendTransactionAsync) {
      toast.error("Wallet not ready", "prep-wallet-wallet");
      return false;
    }

    const step = PREP_WALLET_STEPS.find((s) => s.id === stepId);
    if (!step) return false;

    setCurrentStep(stepId);
    setStepStates((s) => ({ ...s, [stepId]: "running" }));

    try {
      const result = await runPrepWalletStep(stepId, {
        address,
        writeContractAsync,
        sendTransactionAsync,
        publicClient,
        ensureChain,
      });
      setStepStates((s) => ({ ...s, [stepId]: "done" }));
      setLastLog(`${step.label} · ${result.txCount} tx · ${formatDuration(result.durationMs)}`);
      toast.success(step.label, `prep-${stepId}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Step failed";
      setStepStates((s) => ({ ...s, [stepId]: "error" }));
      setLastLog(`${step.label} · ${msg}`);
      toast.error(msg, `prep-error-${stepId}`);
      return false;
    } finally {
      setCurrentStep(null);
    }
  }

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to prep on-chain scoring activity" />;
  }

  async function performSelected() {
    if (!selectedStepId || prepping) return;
    setPrepping(true);
    await runStep(selectedStepId);
    setPrepping(false);
  }

  async function runAll() {
    if (prepping) return;
    setPrepping(true);
    setLastLog(null);
    const reset: Record<PrepWalletStepId, StepStatus> = {} as Record<PrepWalletStepId, StepStatus>;
    for (const step of orderedSteps) reset[step.id] = "pending";
    setStepStates(reset);
    for (const step of orderedSteps) {
      const ok = await runStep(step.id);
      if (!ok) break;
    }
    setPrepping(false);
  }

  return (
    <div className="card-padded space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-label">On-chain prep</p>
          <p className="mt-1 text-sm text-muted-foreground">{doneCount}/{orderedSteps.length} done</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={prepping}
            onClick={() => void performSelected()}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            Run step
          </button>
          <button
            type="button"
            disabled={prepping}
            onClick={() => void runAll()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {prepping ? "Running…" : "Run all"}
          </button>
        </div>
      </div>

      {allDone && (
        <p className="text-sm text-success">Complete — wait for indexers, then rebuild your score.</p>
      )}

      <ul className="space-y-2">
        {orderedSteps.map((step) => {
          const state = stepStates[step.id] ?? "pending";
          const active = currentStep === step.id;
          const selected = selectedStepId === step.id;
          return (
            <li key={step.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  active || selected ? "border-primary/35 bg-primary/5" : "border-border/50"
                }`}
              >
                <input
                  type="radio"
                  name="prep-step"
                  checked={selected}
                  disabled={prepping}
                  onChange={() => setSelectedStepId(step.id)}
                  className="sr-only"
                />
                <Image
                  src={networkLogo(step.network)}
                  alt=""
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] shrink-0 rounded-full object-cover"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-[650]">{step.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{step.description}</p>
                </div>
                <StepBadge status={active ? "running" : state} />
              </label>
            </li>
          );
        })}
      </ul>

      {lastLog && <p className="text-xs text-muted-foreground font-mono">{lastLog}</p>}
    </div>
  );
}
