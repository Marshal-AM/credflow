"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySybilRiskToNodes,
  layoutSybilGraph,
  sybilGraphToLayoutInput,
  type PositionedSybilNode,
} from "@/lib/sybil-graph";
import {
  requestScoreStream,
  type ScoreStreamEvent,
  type SybilGraphEdge,
  type SybilGraphNode,
} from "@/lib/score-stream";
import { usePrefersReducedMotion, sleep } from "@/hooks/use-prefers-reduced-motion";
import { SybilGraphView, type LayoutEdge } from "./SybilGraphView";

type StepRow = {
  id: string;
  label: string;
  detail: string;
  status: "pending" | "running" | "done" | "error";
};

type DetailCard = {
  id: string;
  title: string;
  lines: Array<{ label: string; value: string; tone?: "positive" | "negative" | "neutral" }>;
};

type Props = {
  wallet: string;
  requireReclaim: boolean;
  reclaimSessionId?: string;
  onComplete: (data: Record<string, unknown>, extras?: Record<string, unknown>) => void;
  onAwaitingReclaim: (data: Record<string, unknown>) => void;
  onError: (message: string) => void;
  onBack?: () => void;
};

const STEP_ORDER = ["fetch", "sybil_graph", "sybil_rgcn", "wallet_ml", "shap"] as const;

const STEP_LABELS: Record<string, string> = {
  fetch: "On-chain & borrow fetch",
  sybil_graph: "Wallet neighborhood graph",
  sybil_rgcn: "R-GCN sybil screening",
  wallet_ml: "ML credit model",
  shap: "SHAP explainability upload",
};

export function ScoringLiveView({
  wallet,
  requireReclaim,
  reclaimSessionId,
  onComplete,
  onAwaitingReclaim,
  onError,
  onBack,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const started = useRef(false);

  const [steps, setSteps] = useState<Record<string, StepRow>>(() =>
    Object.fromEntries(
      STEP_ORDER.map((id) => [
        id,
        { id, label: STEP_LABELS[id], detail: "Waiting…", status: "pending" as const },
      ])
    )
  );
  const [nodes, setNodes] = useState<SybilGraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<SybilGraphEdge[]>([]);
  const [graphMeta, setGraphMeta] = useState<Record<string, unknown> | null>(null);
  const [sybilResult, setSybilResult] = useState<Record<string, unknown> | null>(null);
  const [fetchResult, setFetchResult] = useState<Record<string, unknown> | null>(null);
  const [mlResult, setMlResult] = useState<Record<string, unknown> | null>(null);
  const [subScores, setSubScores] = useState<Record<string, unknown> | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [shapCid, setShapCid] = useState<string | null>(null);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const [visibleEdgeCount, setVisibleEdgeCount] = useState(0);
  const [graphReady, setGraphReady] = useState(false);

  const hubId = wallet.toLowerCase();

  const enrichedNodes = useMemo(
    () => applySybilRiskToNodes(nodes, sybilResult, hubId),
    [nodes, sybilResult, hubId]
  );

  const { edges: layoutEdges } = useMemo(
    () => sybilGraphToLayoutInput(enrichedNodes, rawEdges, hubId),
    [enrichedNodes, rawEdges, hubId]
  );

  const positionedNodes: PositionedSybilNode[] = useMemo(() => {
    if (!graphReady || enrichedNodes.length === 0) return [];
    return layoutSybilGraph(enrichedNodes, layoutEdges);
  }, [graphReady, enrichedNodes, layoutEdges]);

  useEffect(() => {
    if (!graphReady || positionedNodes.length === 0) return;

    let cancelled = false;
    async function reveal() {
      if (reducedMotion) {
        setVisibleNodeCount(positionedNodes.length);
        setVisibleEdgeCount(layoutEdges.length);
        return;
      }
      setVisibleNodeCount(0);
      setVisibleEdgeCount(0);
      for (let i = 1; i <= positionedNodes.length; i += 1) {
        if (cancelled) return;
        setVisibleNodeCount(i);
        await sleep(280);
      }
      for (let i = 1; i <= layoutEdges.length; i += 1) {
        if (cancelled) return;
        setVisibleEdgeCount(i);
        await sleep(160);
      }
    }
    void reveal();
    return () => {
      cancelled = true;
    };
  }, [graphReady, positionedNodes, layoutEdges, reducedMotion]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const handleEvent = (event: ScoreStreamEvent) => {
      if (event.type === "step") {
        const { id, status, label } = event.data;
        setSteps((prev) => ({
          ...prev,
          [id]: {
            id,
            label: STEP_LABELS[id] ?? label ?? id,
            detail: label ?? prev[id]?.detail ?? "",
            status: status === "done" ? "done" : status === "running" ? "running" : prev[id]?.status ?? "pending",
          },
        }));
      } else if (event.type === "fetch_result") {
        setFetchResult(event.data);
      } else if (event.type === "graph_node") {
        setNodes((prev) => {
          if (prev.some((n) => n.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
      } else if (event.type === "graph_edge") {
        setRawEdges((prev) => {
          if (prev.some((e) => e.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
      } else if (event.type === "graph_meta") {
        setGraphMeta(event.data);
        setGraphReady(true);
      } else if (event.type === "sybil_result") {
        setSybilResult(event.data);
      } else if (event.type === "ml_result") {
        setMlResult(event.data);
      } else if (event.type === "sub_scores") {
        setSubScores(event.data);
      } else if (event.type === "shap") {
        setShapCid((event.data.cid as string) ?? null);
      } else if (event.type === "score_summary") {
        setSummary(event.data);
      }
    };

    void (async () => {
      const result = await requestScoreStream(
        wallet,
        {
          require_reclaim: requireReclaim,
          reclaim_session_id: reclaimSessionId,
        },
        handleEvent
      );

      if (result.status === "complete") {
        onComplete(
          result.data,
          result.extras as Record<string, unknown> | undefined
        );
      } else if (result.status === "awaiting_reclaim") {
        onAwaitingReclaim(result.data);
      } else {
        onError(result.message);
      }
    })();
  }, [
    wallet,
    requireReclaim,
    reclaimSessionId,
    onComplete,
    onAwaitingReclaim,
    onError,
  ]);

  const detailCards: DetailCard[] = useMemo(() => {
    const cards: DetailCard[] = [];

    if (fetchResult) {
      cards.push({
        id: "fetch",
        title: "Data sources",
        lines: [
          { label: "Wallet txs", value: String(fetchResult.wallet_tx_count ?? "—") },
          { label: "Alchemy txs", value: String(fetchResult.alchemy_tx_count ?? "—") },
          { label: "Borrow positions", value: String(fetchResult.borrow_total ?? "—") },
          { label: "Fetch time", value: `${fetchResult.phase_a_ms ?? "—"} ms` },
        ],
      });
    }

    if (graphMeta) {
      cards.push({
        id: "graph",
        title: "Wallet graph",
        lines: [
          { label: "Nodes", value: String(graphMeta.num_nodes ?? nodes.length) },
          { label: "Edges", value: String(graphMeta.num_edges ?? rawEdges.length) },
          { label: "Counterparties", value: String(graphMeta.unique_counterparties ?? "—") },
          {
            label: "Defaulter links",
            value: String(graphMeta.defaulter_links ?? 0),
            tone: Number(graphMeta.defaulter_links) > 0 ? "negative" : "positive",
          },
          { label: "Lifetime txs", value: String(graphMeta.lifetime_tx_count ?? "—") },
        ],
      });
    }

    if (sybilResult) {
      const probs = sybilResult.sybil_probs as Record<string, number> | undefined;
      cards.push({
        id: "sybil",
        title: "Sybil screening",
        lines: [
          {
            label: "Risk",
            value: String(sybilResult.sybil_risk ?? "—"),
            tone:
              sybilResult.sybil_risk === "high"
                ? "negative"
                : sybilResult.sybil_risk === "low"
                  ? "positive"
                  : "neutral",
          },
          { label: "Method", value: String(sybilResult.method ?? "—") },
          ...(probs
            ? [
                { label: "P(low)", value: `${(probs.low * 100).toFixed(1)}%` },
                { label: "P(medium)", value: `${(probs.medium * 100).toFixed(1)}%` },
                { label: "P(high)", value: `${(probs.high * 100).toFixed(1)}%` },
              ]
            : []),
          {
            label: "Counterparties",
            value: String(sybilResult.unique_counterparties ?? graphMeta?.unique_counterparties ?? "—"),
          },
        ],
      });
    }

    if (mlResult) {
      cards.push({
        id: "ml",
        title: "ML credit model",
        lines: [
          { label: "Off-chain score", value: String(mlResult.cred_score ?? "—") },
          {
            label: "Default prob.",
            value:
              mlResult.default_probability != null
                ? `${(Number(mlResult.default_probability) * 100).toFixed(2)}%`
                : "—",
          },
          { label: "Analysis", value: `${mlResult.wallet_analysis_ms ?? "—"} ms` },
        ],
      });
    }

    if (subScores) {
      cards.push({
        id: "subs",
        title: "Sub-scores",
        lines: [
          { label: "Wallet activity", value: String(subScores.wallet_sub_score ?? "—") },
          { label: "Borrow history", value: String(subScores.borrow_sub_score ?? "—") },
        ],
      });
    }

    if (summary) {
      cards.push({
        id: "final",
        title: "Final CredScore",
        lines: [
          { label: "CredScore", value: String(summary.cred_score ?? "—"), tone: "positive" },
          { label: "On-chain score", value: String(summary.on_chain_cred_score ?? "—") },
          {
            label: "Approved",
            value: summary.approved ? "Yes" : "No",
            tone: summary.approved ? "positive" : "negative",
          },
          ...(summary.rejection_reason
            ? [{ label: "Note", value: String(summary.rejection_reason), tone: "negative" as const }]
            : []),
        ],
      });
    }

    if (shapCid) {
      cards.push({
        id: "shap",
        title: "Explainability",
        lines: [{ label: "IPFS CID", value: shapCid }],
      });
    }

    return cards;
  }, [
    fetchResult,
    graphMeta,
    nodes.length,
    rawEdges.length,
    sybilResult,
    mlResult,
    subScores,
    summary,
    shapCid,
  ]);

  const stepList = STEP_ORDER.map((id) => steps[id]).filter(Boolean);

  return (
    <div className="space-y-3">
      {onBack && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to dashboard
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <section className="space-y-3">
          <div>
            <p className="section-label">Live graph</p>
            <h3 className="mt-1 text-lg font-[650] tracking-tight">Wallet neighborhood</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Building your transaction graph and running R-GCN sybil screening…
            </p>
          </div>
          <SybilGraphView
            nodes={positionedNodes}
            edges={layoutEdges as LayoutEdge[]}
            visibleNodeCount={visibleNodeCount}
            visibleEdgeCount={visibleEdgeCount}
          />
          {graphMeta?.capped ? (
            <p className="text-xs text-muted-foreground">
              Graph capped at 20 nodes for readability — full analysis uses all transfer data.
            </p>
          ) : null}
        </section>

        <div className="grid items-start gap-3 md:grid-cols-[minmax(12rem,32%)_1fr]">
          <div className="min-w-0">
            <p className="section-label mb-2">Pipeline</p>
            <ol className="space-y-2">
              {stepList.map((step) => (
                <li
                  key={step.id}
                  className="flex gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2.5"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      step.status === "done"
                        ? "bg-emerald-400"
                        : step.status === "running"
                          ? "bg-primary animate-pulse"
                          : step.status === "error"
                            ? "bg-red-400"
                            : "bg-muted-foreground/30"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-[650]">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <p className="section-label mb-2 shrink-0">Metrics</p>
            <div className="grid max-h-[18rem] min-h-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain content-start pr-0.5 sm:max-h-[20rem]">
              {detailCards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-xl border border-border/50 bg-card/40 p-3 animate-fade-in"
                >
                  <p className="section-label mb-2">{card.title}</p>
                  <div className="space-y-1.5">
                    {card.lines.map((line) => (
                      <div key={line.label} className="flex justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">{line.label}</span>
                        <span
                          className={`max-w-[55%] truncate text-right font-[650] ${
                            line.tone === "positive"
                              ? "text-success"
                              : line.tone === "negative"
                                ? "text-destructive"
                                : "text-foreground"
                          }`}
                          title={line.value}
                        >
                          {line.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
