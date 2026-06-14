/** Runs a state update inside the View Transitions API when available. */
export function withViewTransition(update: () => void): void {
  if (typeof document === "undefined") {
    update();
    return;
  }
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => {
      update();
    });
    return;
  }
  update();
}

export function agentViewTransitionName(agentId: string): string {
  return `agent-${agentId.replace(/_/g, "-")}`;
}
