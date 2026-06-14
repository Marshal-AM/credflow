"use client";

import type { PositionedWalletNode, WalletGraphEdge } from "@/lib/test-default/liquidation-graph";

type Props = {
  nodes: PositionedWalletNode[];
  edges: WalletGraphEdge[];
  visibleNodeCount: number;
  visibleEdgeCount: number;
  compact?: boolean;
};

function nodeClasses(role: PositionedWalletNode["role"]): string {
  switch (role) {
    case "borrower":
      return "border-primary/50 bg-primary/10 text-foreground";
    case "blacklisted":
      return "border-red-500 bg-red-600/40 text-red-50 shadow-[0_0_0_1px_color-mix(in_oklch,red_35%,transparent)]";
    case "at_risk":
      return "border-amber-400/40 bg-amber-400/10 text-foreground";
    default:
      return "border-border bg-card/80 text-foreground";
  }
}

export function LiquidationGraphView({
  nodes,
  edges,
  visibleNodeCount,
  visibleEdgeCount,
  compact = false,
}: Props) {
  const visibleNodes = nodes.slice(0, visibleNodeCount);
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges
    .slice(0, visibleEdgeCount)
    .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));

  const byId = new Map(visibleNodes.map((n) => [n.id, n]));

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-border/50 bg-[color-mix(in_oklch,var(--color-background)_90%,black)] ${
        compact ? "h-[7.5rem]" : "h-[18rem] sm:h-[20rem]"
      }`}
    >
      <svg
        className="h-full w-full"
        viewBox="-320 -240 640 480"
        preserveAspectRatio="xMidYMid meet"
        aria-label="Linked wallet graph"
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
            <foreignObject x="-56" y="-22" width="112" height="44">
              <div
                className={`flex h-full items-center justify-center rounded-lg border px-2 text-center font-mono text-[10px] font-[650] leading-tight ${nodeClasses(
                  n.role
                )}`}
              >
                {n.label}
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
