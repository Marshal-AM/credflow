"use client";

import { useCallback, useMemo, useState } from "react";
import type { DefaultTestStatus } from "@/lib/test-default-server";
import { toast } from "@/lib/toast";
import {
  TEST_DEFAULT_FLOW,
  initialStepStatuses,
  type FlowStepId,
  type StepResult,
  type StepStatus,
} from "@/lib/test-default/flow-steps";
import { getDefaultScenarioEligibility } from "@/lib/test-default/eligibility";
import {
  buildLiquidationGraph,
  graphSummary,
  layoutWalletGraph,
  type PositionedWalletNode,
  type WalletGraphEdge,
} from "@/lib/test-default/liquidation-graph";
import { usePrefersReducedMotion, sleep } from "@/hooks/use-prefers-reduced-motion";
import {
  snapshotGraphSummary,
  snapshotToGraphResult,
} from "@/lib/test-default/liquidation-snapshot";
import { FlowStepNode } from "./FlowStepNode";
import { LiquidationGraphView } from "./LiquidationGraphView";
import { DefaultScenarioBlocked } from "./DefaultScenarioBlocked";

type Props = {
  status: DefaultTestStatus | null;
  loanId: number | null;
  crashPrice: number;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onRefresh: () => Promise<void>;
  flowCompleted: boolean;
  onFlowCompleted: () => void;
  onWhitelistComplete: () => void;
};

function extractTxs(r: Record<string, unknown>): string[] {
  const crash = r.oracle_crash as Record<string, unknown> | undefined;
  return [
    r.set_price_tx,
    crash?.set_price_tx,
    r.health_warning_tx,
    r.liquidate_tx,
    r.blacklist_tx,
    r.unblacklist_tx,
    ...(Array.isArray(r.lz_broadcast_tx)
      ? r.lz_broadcast_tx.map((t: { tx_hash?: string }) => t.tx_hash)
      : []),
  ].filter((t): t is string => typeof t === "string");
}

function stepMessage(step: string, r: Record<string, unknown>): string {
  if (step === "liquidate") {
    const crash = r.oracle_crash as Record<string, unknown> | undefined;
    return [
      String(r.status ?? "done"),
      crash?.crashed
        ? `Oracle ${crash.previous_eth_price_usd}→${crash.target_eth_price_usd} USD · LTV ${crash.ltv_before_bps}→${crash.ltv_after_bps} bps`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return "Completed";
}

export function TestDefaultFlow({
  status,
  loanId,
  crashPrice,
  apiFetch,
  onRefresh,
  flowCompleted,
  onFlowCompleted,
  onWhitelistComplete,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [running, setRunning] = useState(false);
  const [whitelistBusy, setWhitelistBusy] = useState(false);
  const [stepStatuses, setStepStatuses] = useState(initialStepStatuses);
  const [stepResults, setStepResults] = useState<Partial<Record<FlowStepId, StepResult>>>({});

  const [graphPhase, setGraphPhase] = useState<"idle" | "expanded" | "building" | "summary">("idle");
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [positionedNodes, setPositionedNodes] = useState<PositionedWalletNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<WalletGraphEdge[]>([]);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const [visibleEdgeCount, setVisibleEdgeCount] = useState(0);
  const [liquidationRaw, setLiquidationRaw] = useState<Record<string, unknown> | null>(null);

  const setStepStatus = useCallback((id: FlowStepId, next: StepStatus) => {
    setStepStatuses((prev) => ({ ...prev, [id]: next }));
  }, []);

  const handleWhitelist = useCallback(async () => {
    setWhitelistBusy(true);
    try {
      const res = await apiFetch("/api/test-default/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "unblacklist" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Whitelist failed");
      const result = data.result as Record<string, unknown> | undefined;
      const status = String(result?.status ?? "");
      if (status === "already_whitelisted") {
        toast.success("Wallet already whitelisted on hub and spokes", "test-default-whitelist");
        onWhitelistComplete();
      } else if (status === "no_profile") {
        toast.warning("No hub SBT profile — complete Account scoring first", "test-default-whitelist");
      } else {
        toast.success("Wallet whitelisted on hub and spokes", "test-default-whitelist");
        onWhitelistComplete();
      }
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Whitelist failed", "test-default-whitelist");
    } finally {
      setWhitelistBusy(false);
    }
  }, [apiFetch, onRefresh, onWhitelistComplete]);

  const callStep = useCallback(
    async (step: string, body: Record<string, unknown> = {}) => {
      const res = await apiFetch("/api/test-default/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Step failed");
      return data.result as Record<string, unknown>;
    },
    [apiFetch]
  );

  const revealGraph = useCallback(
    async (nodes: PositionedWalletNode[], edges: WalletGraphEdge[]) => {
      if (reducedMotion) {
        setVisibleNodeCount(nodes.length);
        setVisibleEdgeCount(edges.length);
        return;
      }
      setVisibleNodeCount(0);
      setVisibleEdgeCount(0);
      for (let i = 1; i <= nodes.length; i += 1) {
        setVisibleNodeCount(i);
        await sleep(320);
      }
      for (let i = 1; i <= edges.length; i += 1) {
        setVisibleEdgeCount(i);
        await sleep(180);
      }
    },
    [reducedMotion]
  );

  const runFlow = useCallback(async () => {
    if (!loanId || !status?.ready.hasActiveLoan || running) return;

    setRunning(true);
    setStepStatuses(initialStepStatuses());
    setStepResults({});
    setGraphPhase("idle");
    setGraphExpanded(false);
    setLiquidationRaw(null);
    setPositionedNodes([]);
    setGraphEdges([]);
    setVisibleNodeCount(0);
    setVisibleEdgeCount(0);

    const wallet = status.wallet;
    let currentStepId: FlowStepId | null = null;

    try {
      for (const stepDef of TEST_DEFAULT_FLOW) {
        currentStepId = stepDef.id;
        setStepStatus(stepDef.id, "active");

        if (stepDef.id === "liquidate") {
          setGraphPhase("expanded");
          if (!reducedMotion) await sleep(380);

          const raw = await callStep("liquidate", {
            loan_id: loanId,
            force_grace: true,
          });
          setLiquidationRaw(raw);

          const { nodes, edges } = buildLiquidationGraph(raw, wallet);
          const positioned = layoutWalletGraph(nodes, edges);
          setPositionedNodes(positioned);
          setGraphEdges(edges);
          setGraphPhase("building");
          await revealGraph(positioned, edges);
          await sleep(reducedMotion ? 0 : 400);
          setGraphPhase("summary");

          const result: StepResult = {
            ok: true,
            message: stepMessage("liquidate", raw),
            txs: extractTxs(raw),
            raw,
          };
          setStepResults((prev) => ({ ...prev, liquidate: result }));
          setStepStatus("liquidate", "completed");
          continue;
        }

        let lastRaw: Record<string, unknown> = {};
        for (const apiStep of stepDef.apiSteps) {
          const body: Record<string, unknown> = { loan_id: loanId };
          if (apiStep === "crash_oracle") body.eth_price_usd = crashPrice;
          lastRaw = await callStep(apiStep, body);
        }

        const result: StepResult = {
          ok: true,
          message: stepMessage(stepDef.apiSteps[stepDef.apiSteps.length - 1], lastRaw),
          txs: extractTxs(lastRaw),
          raw: lastRaw,
        };
        setStepResults((prev) => ({ ...prev, [stepDef.id]: result }));
        setStepStatus(stepDef.id, "completed");
        if (!reducedMotion) await sleep(280);
      }

      await onRefresh();
      onFlowCompleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Flow failed";
      if (currentStepId) {
        setStepStatus(currentStepId, "error");
        setStepResults((prev) => ({
          ...prev,
          [currentStepId!]: { ok: false, message: msg, txs: [] },
        }));
      }
      setGraphPhase("idle");
    } finally {
      setRunning(false);
    }
  }, [
    loanId,
    status,
    running,
    crashPrice,
    callStep,
    onRefresh,
    onFlowCompleted,
    revealGraph,
    reducedMotion,
    setStepStatus,
  ]);

  const eligibility = getDefaultScenarioEligibility(status);
  const flowInSession =
    running || TEST_DEFAULT_FLOW.some((step) => stepStatuses[step.id] !== "pending");
  const showBlocked =
    !flowInSession && (eligibility.state === "loading" || eligibility.state === "blocked");
  const canRun = eligibility.state === "ready" && Boolean(loanId) && !running;

  const persistedGraph = useMemo(() => {
    const snapshot = status?.liquidationSnapshot;
    if (!snapshot || !status) return null;
    const raw = snapshotToGraphResult(snapshot);
    const { nodes, edges } = buildLiquidationGraph(raw, status.wallet);
    if (nodes.length <= 1) return null;
    const positioned = layoutWalletGraph(nodes, edges);
    return {
      positioned,
      edges,
      summary: snapshotGraphSummary(snapshot),
    };
  }, [status]);

  const showBlacklistedGraph =
    showBlocked &&
    eligibility.state === "blocked" &&
    status?.hub.hubBlacklisted &&
    persistedGraph != null;

  const showWhitelist = Boolean(status?.hub.hubBlacklisted || flowCompleted);

  return (
    <section className="card-padded">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-[650] tracking-tight">Default scenario</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {showBlocked && eligibility.state === "blocked"
              ? "Resolve the issue below before running the default test flow."
              : "Run the full liquidation path linearly — oracle crash through linked-wallet discovery."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showWhitelist ? (
            <button
              type="button"
              disabled={whitelistBusy}
              onClick={() => void handleWhitelist()}
              className="btn-outline-primary disabled:opacity-50"
            >
              {whitelistBusy ? "Whitelisting…" : "Whitelist wallet"}
            </button>
          ) : null}
          {!showBlocked && (
            <button
              type="button"
              disabled={!canRun}
              onClick={() => void runFlow()}
              className="btn-primary disabled:opacity-50"
            >
              {running ? "Running flow…" : "Test default flow"}
            </button>
          )}
        </div>
      </div>

      {showBlocked ? (
        eligibility.state === "loading" ? (
          <DefaultScenarioBlocked reason="" loading />
        ) : (
          <DefaultScenarioBlocked
            reason={eligibility.reason}
            hint={eligibility.hint}
            graph={
              showBlacklistedGraph ? (
                <div className="space-y-2">
                  <p className="text-xs font-[650] text-foreground">{persistedGraph.summary}</p>
                  <LiquidationGraphView
                    nodes={persistedGraph.positioned}
                    edges={persistedGraph.edges}
                    visibleNodeCount={persistedGraph.positioned.length}
                    visibleEdgeCount={persistedGraph.edges.length}
                    compact={false}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Red nodes were blacklisted as linked to your wallet after default.
                  </p>
                </div>
              ) : undefined
            }
          />
        )
      ) : (
        <ol className="list-none pl-0">
        {TEST_DEFAULT_FLOW.map((stepDef, index) => {
          const isGraphStep = stepDef.isGraph === true;
          const showGraphStage = isGraphStep && graphPhase !== "idle";

          return (
            <FlowStepNode
              key={stepDef.id}
              step={stepDef}
              index={index}
              status={stepStatuses[stepDef.id]}
              isLast={index === TEST_DEFAULT_FLOW.length - 1}
              result={stepResults[stepDef.id]}
            >
              {isGraphStep && showGraphStage && (
                <div
                  className={`td-graph-stage overflow-hidden transition-[max-height,opacity] duration-500 ease-[var(--fluid-easing)] motion-reduce:transition-none ${
                    graphPhase === "expanded" || graphPhase === "building"
                      ? "td-graph-stage--expanded max-h-[22rem] opacity-100"
                      : graphPhase === "summary"
                        ? graphExpanded
                          ? "td-graph-stage--expanded max-h-[22rem] opacity-100"
                          : "td-graph-stage--summary max-h-[11rem] opacity-100"
                        : "max-h-0 opacity-0"
                  }`}
                >
                  {graphPhase === "building" && (
                    <p className="mb-2 text-xs text-muted-foreground">Building linked-wallet graph…</p>
                  )}
                  {graphPhase === "summary" && !graphExpanded && (
                    <div className="space-y-2">
                      <p className="text-xs font-[650] text-foreground">{graphSummary(liquidationRaw)}</p>
                      {positionedNodes.length > 0 && (
                        <LiquidationGraphView
                          nodes={positionedNodes}
                          edges={graphEdges}
                          visibleNodeCount={positionedNodes.length}
                          visibleEdgeCount={graphEdges.length}
                          compact
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setGraphExpanded(true)}
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        View full graph
                      </button>
                    </div>
                  )}
                  {(graphPhase === "expanded" ||
                    graphPhase === "building" ||
                    (graphPhase === "summary" && graphExpanded)) &&
                    positionedNodes.length > 0 && (
                      <div className="space-y-2">
                        {graphPhase === "summary" && graphExpanded && (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">{graphSummary(liquidationRaw)}</p>
                            <button
                              type="button"
                              onClick={() => setGraphExpanded(false)}
                              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Collapse
                            </button>
                          </div>
                        )}
                        <LiquidationGraphView
                          nodes={positionedNodes}
                          edges={graphEdges}
                          visibleNodeCount={visibleNodeCount}
                          visibleEdgeCount={visibleEdgeCount}
                          compact={false}
                        />
                      </div>
                    )}
                  {showGraphStage &&
                    positionedNodes.length === 0 &&
                    graphPhase !== "expanded" &&
                    graphPhase !== "building" && (
                      <p className="text-xs text-muted-foreground">No linked wallets discovered.</p>
                    )}
                </div>
              )}
            </FlowStepNode>
          );
        })}
      </ol>
      )}
    </section>
  );
}
