"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentCard } from "./AgentCard";
import { AgentLogPanel } from "./AgentLogPanel";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";

const AGENT_IDS = [
  "underwriter",
  "portfolio_monitor",
  "liquidation",
  "crosschain_sync",
  "rate_optimizer",
] as const;

type AgentRun = {
  id: string;
  agent_id: string;
  status: string;
  trigger_source: string;
  trigger_event: string | null;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
};

type LogLine = {
  id: string;
  run_id: string;
  logged_at: string;
  level: string;
  message: string;
  agent_id?: string;
};

function mapAgentsFromRuns(runs: AgentRun[]) {
  return AGENT_IDS.map((id) => ({
    agent_id: id,
    last_run: runs.find((r) => r.agent_id === id) || null,
  }));
}

export function AgentsTab() {
  const { address, isConnected, isConnecting, apiFetch } = useWalletApi();
  const [agents, setAgents] = useState<Array<{ agent_id: string; last_run: AgentRun | null }>>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "poll" | "error">(
    "connecting"
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const applyPayload = useCallback((data: Record<string, unknown>) => {
    const nextRuns = (data.runs as AgentRun[]) || [];
    setRuns(nextRuns);
    setAgents((data.agents as typeof agents) || mapAgentsFromRuns(nextRuns));
    setLogs((data.logs as LogLine[]) || []);
  }, []);

  const loadOnce = useCallback(async () => {
    if (!address) return false;
    try {
      const res = await apiFetch("/api/agents");
      const data = await res.json();
      applyPayload(data);
      return true;
    } catch {
      setStreamStatus("error");
      return false;
    }
  }, [address, apiFetch, applyPayload]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    void loadOnce();

    const streamUrl = `/api/agents/stream?wallet=${encodeURIComponent(address)}`;

    if (typeof EventSource === "undefined") {
      setStreamStatus("poll");
      pollId = setInterval(() => void loadOnce(), 3000);
    } else {
      const es = new EventSource(streamUrl);
      esRef.current = es;
      setStreamStatus("connecting");

      es.onopen = () => {
        if (!cancelled) setStreamStatus("live");
      };

      es.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          const nextRuns = (data.runs as AgentRun[]) || [];
          applyPayload({
            ...data,
            agents: mapAgentsFromRuns(nextRuns),
          });
          setStreamStatus("live");
        } catch {
          /* ignore */
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        setStreamStatus("poll");
        es.close();
        esRef.current = null;
        if (!pollId) pollId = setInterval(() => void loadOnce(), 3000);
      };
    }

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (pollId) clearInterval(pollId);
    };
  }, [address, applyPayload, loadOnce]);

  async function trigger(agentId: string) {
    if (!address) return;
    setTriggering(agentId);
    try {
      await apiFetch("/api/agents/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      });
      await loadOnce();
    } finally {
      setTriggering(null);
    }
  }

  const lastByAgent = new Map(agents.map((a) => [a.agent_id, a.last_run]));

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to view agent activity" />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>Automated agents that monitor loans, sync scores, and manage risk.</p>
          <p className="mt-1 text-xs">
            Status:{" "}
            <span className="inline-flex items-center gap-1">
              {streamStatus === "live" && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {streamStatus === "live"
                ? "Live"
                : streamStatus === "poll"
                  ? "Polling"
                  : streamStatus === "connecting"
                    ? "Connecting"
                    : "Offline"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadOnce()} className="btn-secondary text-sm">
            Refresh
          </button>
          <button
            type="button"
            disabled={triggering === "portfolio_monitor"}
            onClick={() => trigger("portfolio_monitor")}
            className="btn-outline-primary disabled:opacity-50"
          >
            Run monitor
          </button>
          <button
            type="button"
            disabled={triggering === "crosschain_sync"}
            onClick={() => trigger("crosschain_sync")}
            className="btn-outline-primary disabled:opacity-50"
          >
            Run sync
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AGENT_IDS.map((id) => (
          <AgentCard
            key={id}
            agentId={id}
            lastRun={lastByAgent.get(id) ?? null}
            selected={selectedAgent === id}
            onSelect={() => setSelectedAgent(selectedAgent === id ? null : id)}
          />
        ))}
      </div>

      <AgentLogPanel logs={logs} runs={runs} filterAgentId={selectedAgent} />
    </div>
  );
}
