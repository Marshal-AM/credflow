"use client";

import type { PositionedSybilNode } from "@/lib/sybil-graph";
import type { SybilNodeRole } from "@/lib/score-stream";

type LayoutEdge = { id: string; source: string; target: string };

type Props = {
  nodes: PositionedSybilNode[];
  edges: LayoutEdge[];
  visibleNodeCount: number;
  visibleEdgeCount: number;
};

function nodeClasses(role: SybilNodeRole, risk?: string): string {
  if (role === "self") return "border-primary/55 bg-primary/15 text-foreground";
  if (role === "defaulter") return "border-destructive/45 bg-destructive/12 text-foreground";
  if (risk === "high") return "border-destructive/35 bg-destructive/8 text-foreground";
  if (risk === "medium") return "border-amber-400/40 bg-amber-400/10 text-foreground";
  return "border-border/70 bg-card/70 text-foreground";
}

export function SybilGraphView({ nodes, edges, visibleNodeCount, visibleEdgeCount }: Props) {
  const visibleNodes = nodes.slice(0, visibleNodeCount);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges
    .slice(0, visibleEdgeCount)
    .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

  const byId = new Map(visibleNodes.map((n) => [n.id, n]));

  return (
    <div className="relative h-[20rem] w-full overflow-hidden rounded-xl border border-border/50 bg-[color-mix(in_oklch,var(--color-background)_90%,black)] sm:h-[22rem]">
      {nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Waiting for transfer history…
        </div>
      ) : (
        <svg
          className="h-full w-full"
          viewBox="-320 -240 640 480"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Wallet neighborhood graph"
        >
          <g stroke="color-mix(in oklch, var(--color-border) 85%, transparent)" strokeWidth="1.5">
            {visibleEdges.map((e) => {
              const s = byId.get(e.source);
              const t = byId.get(e.target);
              if (!s || !t) return null;
              return (
                <line
                  key={e.id}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  className="td-graph-edge"
                />
              );
            })}
          </g>
          {visibleNodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`} className="td-graph-node">
              <foreignObject x="-58" y="-26" width="116" height="52">
                <div
                  className={`flex h-full flex-col items-center justify-center rounded-lg border px-1.5 py-1 text-center font-mono text-[9px] font-[650] leading-tight ${nodeClasses(
                    n.role,
                    n.risk
                  )}`}
                >
                  <span>{n.label}</span>
                  {n.role !== "self" && n.tx_count != null && n.tx_count > 0 && (
                    <span className="mt-0.5 text-[8px] font-normal text-muted-foreground">
                      {n.tx_count} tx
                    </span>
                  )}
                </div>
              </foreignObject>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export type { LayoutEdge };
