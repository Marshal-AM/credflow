"use client";

import { useCallback, useEffect, useState } from "react";
import type { DefaultTestStatus } from "@/lib/test-default-server";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";
import { toast } from "@/lib/toast";
import { LiveStatePanel } from "./LiveStatePanel";
import { TestDefaultFlow } from "./TestDefaultFlow";

export function TestDefaultTab() {
  const { address, isConnected, isConnecting, apiFetch } = useWalletApi();
  const [status, setStatus] = useState<DefaultTestStatus | null>(null);
  const [liveStateOpen, setLiveStateOpen] = useState(true);
  const [flowCompleted, setFlowCompleted] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const crashPrice = 200;

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

  async function resetWallet() {
    setResetBusy(true);
    try {
      const res = await apiFetch("/api/test-default/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "unblacklist" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      toast.success("Wallet removed from blacklist", "test-default-reset");
      setFlowCompleted(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed", "test-default-reset");
    } finally {
      setResetBusy(false);
    }
  }

  const loanId = status?.hub.loanId ? Number(status.hub.loanId) : null;

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to run the default test flow" />;
  }

  return (
    <div className="space-y-4">
      <LiveStatePanel
        status={status}
        open={liveStateOpen}
        onToggle={() => setLiveStateOpen((v) => !v)}
        onRefresh={() => void load()}
        flowCompleted={flowCompleted}
        resetBusy={resetBusy}
        onReset={() => void resetWallet()}
      />

      <TestDefaultFlow
        status={status}
        loanId={loanId}
        crashPrice={crashPrice}
        apiFetch={apiFetch}
        onRefresh={load}
        onFlowCompleted={() => setFlowCompleted(true)}
      />
    </div>
  );
}
