"use client";

import { useEffect, useRef } from "react";
import type { LogLine } from "./agent-types";

type Props = {
  logs: LogLine[];
  emptyMessage?: string;
};

function levelClass(level: string): string {
  if (level === "error") return "text-red-400";
  if (level === "warn" || level === "warning") return "text-amber-400";
  return "text-foreground/75";
}

export function AgentLogTerminal({
  logs,
  emptyMessage = "No runs yet — logs appear when the scheduler runs or you use score, mint, borrow, or repay.",
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col border-t border-border/50 bg-[color-mix(in_oklch,var(--color-background)_88%,black)]">
      <div
        className="flex shrink-0 items-center gap-1.5 border-b border-border/40 px-3 py-1.5"
        aria-hidden
      >
        <span className="h-2 w-2 rounded-full bg-red-400/70" />
        <span className="h-2 w-2 rounded-full bg-amber-400/70" />
        <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Output
        </span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 font-mono text-[11px] leading-[1.45]"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!logs.length ? (
          <p className="text-muted-foreground/70">{emptyMessage}</p>
        ) : (
          <ul className="space-y-0.5">
            {logs.map((line) => {
              const t = new Date(line.logged_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              const phase =
                line.metadata && typeof line.metadata.phase === "string"
                  ? line.metadata.phase
                  : null;
              return (
                <li key={line.id} className="break-words">
                  <span className="text-muted-foreground/60">{t}</span>{" "}
                  {phase && (
                    <span className="text-muted-foreground/45">[{phase}] </span>
                  )}
                  <span className={levelClass(line.level)}>{line.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
