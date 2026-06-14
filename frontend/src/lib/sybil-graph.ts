/**
 * Sybil wallet graph layout (d3-force), adapted from test-default liquidation graph.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { SybilGraphEdge, SybilGraphNode } from "@/lib/score-stream";

export type PositionedSybilNode = SybilGraphNode & { x: number; y: number };

const NODE_RADIUS = 68;

export function sybilGraphToLayoutInput(
  nodes: SybilGraphNode[],
  edges: SybilGraphEdge[],
  hubId: string
): { nodes: SybilGraphNode[]; edges: Array<{ id: string; source: string; target: string }> } {
  const layoutEdges = edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
  }));

  // Star fallback: hub -> each counterparty when no edges yet
  if (layoutEdges.length === 0 && nodes.length > 1) {
    for (const n of nodes) {
      if (n.id === hubId) continue;
      layoutEdges.push({
        id: `hub-${n.id}`,
        source: hubId,
        target: n.id,
      });
    }
  }

  return { nodes, edges: layoutEdges };
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

export function layoutSybilGraph(
  nodes: SybilGraphNode[],
  edges: Array<{ id: string; source: string; target: string }>
): PositionedSybilNode[] {
  if (nodes.length === 0) return [];

  const radius = Math.max(160, nodes.length * 34);
  const sim: SimNode[] = nodes.map((n, i) => ({
    id: n.id,
    x: Math.cos((i / Math.max(nodes.length, 1)) * 2 * Math.PI) * radius,
    y: Math.sin((i / Math.max(nodes.length, 1)) * 2 * Math.PI) * radius,
  }));

  const links = edges.map((e) => ({ source: e.source, target: e.target }));

  forceSimulation<SimNode>(sim)
    .force("charge", forceManyBody().strength(-480))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(links as never)
        .id((d) => d.id)
        .distance(120)
    )
    .force("collide", forceCollide<SimNode>(NODE_RADIUS).strength(0.85).iterations(2))
    .force("center", forceCenter(0, 0))
    .stop()
    .tick(260);

  const byId = new Map(sim.map((s) => [s.id, s]));
  return nodes.map((n) => {
    const s = byId.get(n.id)!;
    return { ...n, x: Math.round(s.x ?? 0), y: Math.round(s.y ?? 0) };
  });
}

export function applySybilRiskToNodes(
  nodes: SybilGraphNode[],
  sybil: Record<string, unknown> | null,
  hubId: string
): SybilGraphNode[] {
  const risk = (sybil?.sybil_risk as string | undefined)?.toLowerCase();
  const probs = sybil?.sybil_probs as Record<string, number> | undefined;

  return nodes.map((n) => {
    if (n.role === "defaulter") {
      return { ...n, risk: "high" as const };
    }
    if (n.id === hubId && risk) {
      return { ...n, risk: risk as "low" | "medium" | "high" };
    }
    if (n.role === "counterparty" && probs) {
      const pHigh = probs.high ?? 0;
      if (pHigh > 0.5) return { ...n, risk: "high" as const };
      if (pHigh > 0.25) return { ...n, risk: "medium" as const };
    }
    return n;
  });
}

export type GraphViewBox = { x: number; y: number; width: number; height: number };

/** Fit viewBox to node positions with padding for labels. */
export function computeGraphViewBox(
  nodes: Array<{ x: number; y: number }>,
  padding = 100
): GraphViewBox {
  if (nodes.length === 0) {
    return { x: -320, y: -240, width: 640, height: 480 };
  }

  const halfW = 62;
  const halfH = 30;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    minX = Math.min(minX, n.x - halfW);
    maxX = Math.max(maxX, n.x + halfW);
    minY = Math.min(minY, n.y - halfH);
    maxY = Math.max(maxY, n.y + halfH);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
