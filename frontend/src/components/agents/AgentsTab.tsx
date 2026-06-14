"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCard } from "./AgentCard";
import { AgentFeedBadge } from "./AgentFeedBadge";
import { cardVariant, gridContainerClass, gridItemClass } from "./agent-grid-layout";
import { agentViewTransitionName, withViewTransition } from "./view-transition";
import {
  AGENT_IDS,
  logsForAgent,
  mapAgentsFromRuns,
  type AgentId,
  type AgentRun,
  type LogLine,
} from "./agent-types";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";

export function AgentsTab() {
  const { address, isConnected, isConnecting, apiFetch } = useWalletApi();
  const [agents, setAgents] = useState<Array<{ agent_id: string; last_run: AgentRun | null }>>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "poll" | "error">(
    "connecting"
  );
  const [focusedId, setFocusedId] = useState<AgentId | null>(null);
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
      setStreamStatus((prev) => (prev === "error" ? "poll" : prev));
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

    const startPolling = () => {
      if (pollId || cancelled) return;
      setStreamStatus("poll");
      pollId = setInterval(() => void loadOnce(), 2000);
    };

    if (typeof EventSource === "undefined") {
      startPolling();
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
        es.close();
        esRef.current = null;
        startPolling();
      };
    }

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (pollId) clearInterval(pollId);
    };
  }, [address, applyPayload, loadOnce]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && focusedId) {
        e.preventDefault();
        withViewTransition(() => setFocusedId(null));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedId]);

  function focusAgent(id: AgentId) {
    withViewTransition(() => setFocusedId(id));
  }

  function minimizeGrid() {
    withViewTransition(() => setFocusedId(null));
  }

  const lastByAgent = useMemo(
    () => new Map(agents.map((a) => [a.agent_id, a.last_run])),
    [agents]
  );

  const logsByAgent = useMemo(() => {
    const map = new Map<string, LogLine[]>();
    for (const id of AGENT_IDS) {
      map.set(id, logsForAgent(id, logs, runs));
    }
    return map;
  }, [logs, runs]);

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to view agent activity" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-muted-foreground">
            Live logs from the scheduler and your account flows (score, mint, borrow, repay).
          </p>
          <AgentFeedBadge status={streamStatus} />
        </div>
        <div className="flex items-center gap-2">
          {focusedId && (
            <button
              type="button"
              onClick={minimizeGrid}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              Show all
            </button>
          )}
          <button type="button" onClick={() => void loadOnce()} className="btn-secondary text-sm">
            Refresh
          </button>
        </div>
      </div>

      <div className={gridContainerClass(focusedId)}>
        {AGENT_IDS.map((id, index) => {
          const lastRun = lastByAgent.get(id) ?? null;
          const variant = cardVariant(id, focusedId);

          return (
            <div
              key={id}
              data-agent-id={id}
              className={gridItemClass(id, focusedId, index)}
              style={{ viewTransitionName: agentViewTransitionName(id) }}
            >
              <AgentCard
                agentId={id}
                lastRun={lastRun}
                logs={logsByAgent.get(id) ?? []}
                variant={variant}
                onActivate={() => focusAgent(id)}
                onMinimize={variant === "focused" ? minimizeGrid : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
