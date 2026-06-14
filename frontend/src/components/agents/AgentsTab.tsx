"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCard } from "./AgentCard";
import { AgentFeedBadge } from "./AgentFeedBadge";
import { cardVariant, gridContainerClass, gridItemClass } from "./agent-grid-layout";
import { agentViewTransitionName, withViewTransition } from "./view-transition";
import {
  AGENT_IDS,
  AGENT_META,
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
        if (!cancelled) return;
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
            Each agent runs in the background and streams output to its own log.
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
          const meta = AGENT_META[id];
          const lastRun = lastByAgent.get(id) ?? null;
          const isRunning = triggering === id || lastRun?.status === "running";
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
                running={isRunning}
                onActivate={() => focusAgent(id)}
                onMinimize={variant === "focused" ? minimizeGrid : undefined}
                onRun={meta.canTrigger ? () => void trigger(id) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
