"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { AgentLogTerminal } from "./AgentLogTerminal";
import { AgentTriggerBadge } from "./AgentTriggerBadge";
import { AGENT_META, type AgentRun, type LogLine } from "./agent-types";

export type AgentCardVariant = "default" | "compact" | "focused";

type Props = {
  agentId: string;
  lastRun: AgentRun | null;
  logs: LogLine[];
  variant?: AgentCardVariant;
  onActivate?: () => void;
  onMinimize?: () => void;
};

function isRunFailed(status: string): boolean {
  return status === "failed" || status === "error";
}

function isRunSuccess(status: string): boolean {
  return status === "success" || status === "completed";
}

function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function lastRunLabel(lastRun: AgentRun | null, now = Date.now()): string {
  if (lastRun?.status === "running") return "Running now";
  if (!lastRun) return "No runs yet";
  const when = formatRelativeTime(lastRun.finished_at || lastRun.started_at, now);
  if (isRunFailed(lastRun.status)) {
    return when ? `Last run: failed · ${when}` : "Last run: failed";
  }
  if (isRunSuccess(lastRun.status)) {
    return when ? `Last run: success · ${when}` : "Last run: success";
  }
  return when ? `Last run: ${lastRun.status} · ${when}` : `Last run: ${lastRun.status}`;
}

function StatusDot({
  isActive,
  lastRun,
  failed,
}: {
  isActive: boolean;
  lastRun: AgentRun | null;
  failed: boolean;
}) {
  return (
    <span
      className={`block h-2 w-2 shrink-0 rounded-full ${
        isActive
          ? "animate-pulse bg-primary"
          : lastRun
            ? failed
              ? "bg-red-400"
              : "bg-emerald-400"
            : "bg-muted-foreground/40"
      }`}
      aria-hidden
    />
  );
}

function ExpandChevron() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AgentTitle({
  label,
  isActive,
  lastRun,
  failed,
  compact,
}: {
  label: string;
  isActive: boolean;
  lastRun: AgentRun | null;
  failed: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-[1.125rem] w-2 shrink-0 items-center justify-center">
        <StatusDot isActive={isActive} lastRun={lastRun} failed={failed} />
      </span>
      <h3
        className={`truncate font-[650] leading-[1.125rem] tracking-tight ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        {label}
      </h3>
    </div>
  );
}

export function AgentCard({
  agentId,
  lastRun,
  logs,
  variant = "default",
  onActivate,
  onMinimize,
}: Props) {
  const meta = AGENT_META[agentId as keyof typeof AGENT_META];
  const label = meta?.label ?? agentId;
  const description = meta?.description ?? "";
  const isRunning = lastRun?.status === "running";
  const failed = lastRun ? isRunFailed(lastRun.status) : false;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!lastRun || isRunning) return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [lastRun?.id, lastRun?.status, isRunning]);

  const runLabel = lastRunLabel(lastRun, nowMs);
  const isCompact = variant === "compact";
  const isFocused = variant === "focused";
  const isInteractive = isCompact || variant === "default";
  const logCount = logs.length;

  function handleKeyDown(e: KeyboardEvent) {
    if (!isInteractive || !onActivate) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  }

  return (
    <article
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `Expand ${label} agent logs` : undefined}
      aria-expanded={isFocused ? true : isInteractive ? false : undefined}
      onClick={isInteractive ? onActivate : undefined}
      onKeyDown={handleKeyDown}
      className={`agent-card card-shell flex h-full flex-col overflow-hidden ${
        isCompact
          ? "agent-card--compact h-[5.25rem] max-h-[5.25rem] min-h-[5.25rem] cursor-pointer border-l-2 border-l-primary/35 bg-[color-mix(in_oklch,var(--color-card)_92%,var(--color-primary))] hover:border-l-primary/55 hover:bg-[color-mix(in_oklch,var(--color-card)_88%,var(--color-primary))]"
          : isFocused
            ? "agent-card--focused h-[32rem] max-h-[32rem] min-h-[32rem] ring-1 ring-primary/25"
            : "agent-card--default h-[22rem] max-h-[22rem] min-h-[22rem]"
      } ${
        isInteractive
          ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          : ""
      }`}
    >
      <header
        className={`agent-card__header shrink-0 ${
          isCompact ? "flex flex-1 items-stretch p-3" : "flex flex-col gap-3 p-4 pb-3"
        }`}
      >
        {isCompact ? (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <AgentTitle
                label={label}
                isActive={isRunning}
                lastRun={lastRun}
                failed={failed}
                compact
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[10px] text-muted-foreground">
                <span className="font-[650] text-foreground/80">{runLabel}</span>
                <span aria-hidden>·</span>
                <span>
                  {logCount} log {logCount === 1 ? "line" : "lines"}
                </span>
              </div>
            </div>
            <ExpandChevron />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <AgentTitle
                  label={label}
                  isActive={isRunning}
                  lastRun={lastRun}
                  failed={failed}
                />
                <p className="mt-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
              {isFocused && onMinimize && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMinimize();
                  }}
                  aria-label="Minimize agent grid"
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  Minimize
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-4 text-xs text-muted-foreground">
              <span className="font-[650] text-foreground/90">{runLabel}</span>
              {lastRun?.summary && (
                <>
                  <span className="hidden text-border sm:inline" aria-hidden>
                    ·
                  </span>
                  <span className="truncate">{lastRun.summary}</span>
                </>
              )}
              {lastRun && <AgentTriggerBadge source={lastRun.trigger_source} />}
            </div>
          </>
        )}
      </header>

      <div
        className={
          isCompact
            ? "agent-card__terminal hidden"
            : "agent-card__terminal flex min-h-0 flex-1 flex-col"
        }
        aria-hidden={isCompact}
      >
        <AgentLogTerminal logs={logs} />
      </div>
    </article>
  );
}
