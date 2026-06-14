"use client";

import type { ReactNode } from "react";
import type { FlowStepDef, StepStatus } from "@/lib/test-default/flow-steps";
import { TxList, type StepResult } from "./LiveStatePanel";

type Props = {
  step: FlowStepDef;
  index: number;
  status: StepStatus;
  isLast: boolean;
  result?: StepResult;
  children?: ReactNode;
};

function dotClass(status: StepStatus): string {
  switch (status) {
    case "completed":
      return "border-primary bg-primary";
    case "active":
      return "border-primary bg-primary/30 animate-pulse";
    case "error":
      return "border-destructive bg-destructive";
    default:
      return "border-border bg-muted";
  }
}

function cardClass(status: StepStatus): string {
  switch (status) {
    case "completed":
      return "border-primary/45 bg-primary/[0.06]";
    case "active":
      return "border-primary ring-1 ring-primary/25";
    case "error":
      return "border-destructive/40 bg-destructive/5";
    default:
      return "border-border/60 bg-card/30";
  }
}

export function FlowStepNode({ step, index, status, isLast, result, children }: Props) {
  return (
    <li className="td-flow-step relative flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-[650] ${dotClass(status)} ${
            status === "completed" ? "text-primary-foreground" : "text-muted-foreground"
          }`}
          aria-hidden
        >
          {status === "completed" ? "✓" : index + 1}
        </span>
        {!isLast && <span className="td-flow-rail mt-1 w-px flex-1 min-h-[1.5rem]" aria-hidden />}
      </div>

      <div className={`mb-4 min-w-0 flex-1 rounded-xl border p-4 transition-colors duration-300 ${cardClass(status)}`}>
        <p className="section-label">Step {index + 1}</p>
        <h3 className="mt-1 font-[650]">{step.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>

        {status === "active" && !children && (
          <p className="mt-3 text-xs text-muted-foreground">Running…</p>
        )}

        {result && (
          <div className="mt-3 text-xs">
            <p className={result.ok ? "text-muted-foreground" : "text-destructive"}>{result.message}</p>
            <TxList txs={result.txs} />
          </div>
        )}

        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}
