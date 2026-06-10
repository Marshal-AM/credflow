"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentCard } from "./AgentCard";
import { AgentLogPanel } from "./AgentLogPanel";

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
  const [wallet, setWallet] = useState("");
  const [agents, setAgents] = useState<Array<{ agent_id: string; last_run: AgentRun | null }>>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [sessionDir, setSessionDir] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "poll" | "error">(
    "connecting"
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const applyPayload = useCallback((data: Record<string, unknown>) => {
    if (typeof data.wallet === "string") setWallet(data.wallet);
    const nextRuns = (data.runs as AgentRun[]) || [];
    setRuns(nextRuns);
    setAgents((data.agents as typeof agents) || mapAgentsFromRuns(nextRuns));
    setLogs((data.logs as LogLine[]) || []);
    setSessionDir((data.session_dir as string) || (data.sessionDir as string) || null);
  }, []);

  const loadOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      applyPayload(data);
      return true;
    } catch {
      setStreamStatus("error");
      return false;
    }
  }, [applyPayload]);

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    void loadOnce();

    if (typeof EventSource === "undefined") {
      setStreamStatus("poll");
      pollId = setInterval(() => void loadOnce(), 3000);
    } else {
      const es = new EventSource("/api/agents/stream");
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
  }, [applyPayload, loadOnce]);

  async function trigger(agentId: string) {
    setTriggering(agentId);
    try {
      await fetch("/api/agents/trigger", {
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          <p>
            Agent activity for <span className="font-mono">{wallet || "…"}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Logs stream from{" "}
            <code className="text-[11px]">logs/agent-runs</code>
            {sessionDir ? ` (${sessionDir.split(/[/\\]/).slice(-2).join("/")})` : ""} —{" "}
            {streamStatus === "live"
              ? "live"
              : streamStatus === "poll"
                ? "polling fallback"
                : streamStatus}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadOnce()}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={triggering === "portfolio_monitor"}
            onClick={() => trigger("portfolio_monitor")}
            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-50"
          >
            Run monitor
          </button>
          <button
            type="button"
            disabled={triggering === "crosschain_sync"}
            onClick={() => trigger("crosschain_sync")}
            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-50"
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
