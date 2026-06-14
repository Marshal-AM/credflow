"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeGraphViewBox } from "@/lib/sybil-graph";
import type { PositionedWalletNode, WalletGraphEdge } from "@/lib/test-default/liquidation-graph";

type Props = {
  nodes: PositionedWalletNode[];
  edges: WalletGraphEdge[];
  visibleNodeCount: number;
  visibleEdgeCount: number;
  compact?: boolean;
};

type Camera = { tx: number; ty: number; scale: number };

const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [camera, setCamera] = useState<Camera>({ tx: 0, ty: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);

  const visibleNodes = nodes.slice(0, visibleNodeCount);
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges
    .slice(0, visibleEdgeCount)
    .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));

  const byId = new Map(visibleNodes.map((n) => [n.id, n]));

  const viewBox = useMemo(
    () => computeGraphViewBox(nodes.length > 0 ? nodes : visibleNodes),
    [nodes, visibleNodes]
  );

  const resetCamera = useCallback(() => {
    setCamera({ tx: 0, ty: 0, scale: 1 });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setCamera((prev) => ({
        ...prev,
        scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor)),
      }));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pxToSvg = useCallback(
    (dx: number, dy: number) => {
      const svg = svgRef.current;
      if (!svg) return { dx, dy };
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { dx, dy };
      return {
        dx: dx * (viewBox.width / rect.width),
        dy: dy * (viewBox.height / rect.height),
      };
    },
    [viewBox.width, viewBox.height]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { x: e.clientX, y: e.clientY, tx: camera.tx, ty: camera.ty };
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [camera.tx, camera.ty]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { dx, dy } = pxToSvg(e.clientX - drag.x, e.clientY - drag.y);
      setCamera((prev) => ({
        ...prev,
        tx: drag.tx + dx,
        ty: drag.ty + dy,
      }));
    },
    [pxToSvg]
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const transform = `translate(${camera.tx}, ${camera.ty}) scale(${camera.scale})`;

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div
        ref={containerRef}
        className={`relative w-full touch-none overflow-hidden rounded-xl border border-border/50 bg-[color-mix(in_oklch,var(--color-background)_90%,black)] ${
          compact ? "h-[7.5rem]" : "h-[18rem] sm:h-[20rem]"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            No linked wallets to display
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="h-full w-full select-none"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="Linked wallet graph"
          >
            <g transform={transform}>
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
            </g>
          </svg>
        )}
      </div>
      {nodes.length > 0 && !compact && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Scroll to zoom · drag to pan</span>
          <button
            type="button"
            onClick={resetCamera}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset view
          </button>
        </div>
      )}
    </div>
  );
}
