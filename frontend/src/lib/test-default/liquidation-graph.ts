/**
 * Wallet graph builder + d3-force layout (adapted from reference/lib/graph).
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

export type WalletNodeRole = "borrower" | "blacklisted" | "at_risk" | "linked";

export type WalletGraphNode = {
  id: string;
  label: string;
  role: WalletNodeRole;
};

export type WalletGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type PositionedWalletNode = WalletGraphNode & {
  x: number;
  y: number;
};

const NODE_RADIUS = 72;

function shortenAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function buildLiquidationGraph(
  result: Record<string, unknown>,
  walletAddress: string
): { nodes: WalletGraphNode[]; edges: WalletGraphEdge[] } {
  const borrowerRaw = (result.borrower as string | undefined) || walletAddress;
  const borrower = borrowerRaw.toLowerCase();
  const blacklisted = ((result.blacklisted as string[]) || []).map((a) => a.toLowerCase());
  const atRisk = (result.at_risk_loans as Array<{ wallet?: string }> | undefined) || [];
  const groq = result.groq as { wallets_to_blacklist?: string[] } | undefined;
  const groqList = (groq?.wallets_to_blacklist || []).map((a) => a.toLowerCase());

  const nodeMap = new Map<string, WalletGraphNode>();
  nodeMap.set(borrower, {
    id: borrower,
    label: shortenAddress(borrowerRaw),
    role: "borrower",
  });

  function addLinked(addr: string, role: WalletNodeRole) {
    const id = addr.toLowerCase();
    if (id === borrower) return;
    const existing = nodeMap.get(id);
    if (existing) {
      if (role === "blacklisted" && existing.role !== "borrower") {
        existing.role = "blacklisted";
      }
      return;
    }
    nodeMap.set(id, { id, label: shortenAddress(addr), role });
  }

  for (const addr of blacklisted) addLinked(addr, "blacklisted");
  for (const addr of groqList) addLinked(addr, "blacklisted");
  for (const item of atRisk) {
    if (item.wallet) addLinked(item.wallet, "at_risk");
  }

  const nodes = Array.from(nodeMap.values());
  const edges: WalletGraphEdge[] = nodes
    .filter((n) => n.id !== borrower)
    .map((n) => ({
      id: `edge-${borrower}-${n.id}`,
      source: borrower,
      target: n.id,
    }));

  return { nodes, edges };
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

export function layoutWalletGraph(
  nodes: WalletGraphNode[],
  edges: WalletGraphEdge[]
): PositionedWalletNode[] {
  if (nodes.length === 0) return [];

  const radius = Math.max(180, nodes.length * 36);
  const sim: SimNode[] = nodes.map((n, i) => ({
    id: n.id,
    x: Math.cos((i / Math.max(nodes.length, 1)) * 2 * Math.PI) * radius,
    y: Math.sin((i / Math.max(nodes.length, 1)) * 2 * Math.PI) * radius,
  }));

  const links = edges.map((e) => ({ source: e.source, target: e.target }));

  forceSimulation<SimNode>(sim)
    .force("charge", forceManyBody().strength(-520))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(links as never)
        .id((d) => d.id)
        .distance(140)
    )
    .force("collide", forceCollide<SimNode>(NODE_RADIUS).strength(0.9).iterations(2))
    .force("center", forceCenter(0, 0))
    .stop()
    .tick(280);

  const byId = new Map(sim.map((s) => [s.id, s]));
  return nodes.map((n) => {
    const s = byId.get(n.id)!;
    return { ...n, x: Math.round(s.x ?? 0), y: Math.round(s.y ?? 0) };
  });
}

export function graphSummary(result: Record<string, unknown> | null): string {
  if (!result) return "No liquidation data yet.";
  const blacklisted = ((result.blacklisted as string[]) || []).length;
  const atRisk = ((result.at_risk_loans as unknown[]) || []).length;
  const status = String(result.status ?? "done");
  return `${status} · ${blacklisted} blacklisted · ${atRisk} at-risk loans`;
}
