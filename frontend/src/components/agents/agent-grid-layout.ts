import { AGENT_IDS, type AgentId } from "./agent-types";

/** Corner slots for non-focused agents (stable order by AGENT_IDS index). */
const CORNER_SLOTS: readonly string[] = [
  "lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:row-span-1",
  "lg:col-span-2 lg:col-start-11 lg:row-start-1 lg:row-span-1",
  "lg:col-span-2 lg:col-start-1 lg:row-start-4 lg:row-span-1",
  "lg:col-span-2 lg:col-start-11 lg:row-start-4 lg:row-span-1",
];

export function gridContainerClass(focusedId: AgentId | null): string {
  const base = "agent-grid grid w-full gap-3";
  if (!focusedId) {
    return `${base} agent-grid--balanced`;
  }
  return `${base} agent-grid--focused lg:min-h-[38rem]`;
}

export function gridItemClass(agentId: AgentId, focusedId: AgentId | null, index: number): string {
  const base = "agent-grid__item min-w-0 h-full";

  if (!focusedId) {
    const span = index < 3 ? "lg:col-span-2" : "lg:col-span-3";
    return `${base} ${span}`;
  }

  if (agentId === focusedId) {
    return `${base} agent-grid__item--focused col-span-2 lg:col-span-8 lg:col-start-3 lg:row-span-4 lg:row-start-1`;
  }

  const others = AGENT_IDS.filter((id) => id !== focusedId);
  const slot = others.indexOf(agentId);
  const corner = CORNER_SLOTS[slot] ?? CORNER_SLOTS[0];
  return `${base} agent-grid__item--corner col-span-1 ${corner}`;
}

export function cardVariant(
  agentId: AgentId,
  focusedId: AgentId | null
): "default" | "compact" | "focused" {
  if (!focusedId) return "default";
  if (agentId === focusedId) return "focused";
  return "compact";
}
