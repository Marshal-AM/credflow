"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeGraphViewBox, type PositionedSybilNode } from "@/lib/sybil-graph";
import type { SybilNodeRole } from "@/lib/score-stream";

type LayoutEdge = { id: string; source: string; target: string };

type Props = {
  nodes: PositionedSybilNode[];
  edges: LayoutEdge[];
  visibleNodeCount: number;
  visibleEdgeCount: number;
};

type Camera = { tx: number; ty: number; scale: number };

const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;

function nodeClasses(role: SybilNodeRole, risk?: string): string {
  if (role === "self") return "border-primary/55 bg-primary/15 text-foreground";
  if (role === "defaulter") return "border-destructive/45 bg-destructive/12 text-foreground";
  if (risk === "high") return "border-destructive/35 bg-destructive/8 text-foreground";
  if (risk === "medium") return "border-amber-400/40 bg-amber-400/10 text-foreground";
  return "border-border/70 bg-card/70 text-foreground";
}

export function SybilGraphView({ nodes, edges, visibleNodeCount, visibleEdgeCount }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [camera, setCamera] = useState<Camera>({ tx: 0, ty: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);

  const visibleNodes = nodes.slice(0, visibleNodeCount);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges
    .slice(0, visibleEdgeCount)
    .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

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
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative h-[28rem] w-full touch-none overflow-hidden rounded-xl border border-border/50 bg-[color-mix(in_oklch,var(--color-background)_90%,black)] sm:h-[32rem]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Waiting for transfer history…
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="h-full w-full select-none"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="Wallet neighborhood graph"
          >
            <g transform={transform}>
              <g stroke="color-mix(in oklch, var(--color-border) 85%, transparent)" strokeWidth={1.5}>
                {visibleEdges.map((edge) => {
                  const s = byId.get(edge.source);
                  const t = byId.get(edge.target);
                  if (!s || !t) return null;
                  return (
                    <line
                      key={edge.id}
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
                  <foreignObject x={-58} y={-26} width={116} height={52}>
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
            </g>
          </svg>
        )}
      </div>
      {nodes.length > 0 && (
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

export type { LayoutEdge };
