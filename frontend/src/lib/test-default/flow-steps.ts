export type FlowStepId = "crash_oracle" | "health_warning" | "grace" | "liquidate";

export type FlowStepDef = {
  id: FlowStepId;
  title: string;
  description: string;
  isGraph?: boolean;
  /** Backend steps executed when this node runs (grace = two calls). */
  apiSteps: readonly string[];
};

export const TEST_DEFAULT_FLOW: FlowStepDef[] = [
  {
    id: "crash_oracle",
    title: "Crash ETH price",
    description: "Drop the hub oracle price so collateral falls and LTV rises.",
    apiSteps: ["crash_oracle"],
  },
  {
    id: "health_warning",
    title: "Health warning",
    description: "Emit an on-chain HealthWarning when LTV is elevated.",
    apiSteps: ["health_warning"],
  },
  {
    id: "grace",
    title: "Grace period",
    description: "Start grace on the overdue loan, then expire it for testing.",
    apiSteps: ["grace_start", "grace_expire"],
  },
  {
    id: "liquidate",
    title: "Liquidate & broadcast",
    description: "Liquidate on hub, discover linked wallets, broadcast default via LayerZero.",
    isGraph: true,
    apiSteps: ["liquidate"],
  },
];

export type StepStatus = "pending" | "active" | "completed" | "error";

export type StepResult = {
  ok: boolean;
  message: string;
  txs: string[];
  raw?: Record<string, unknown>;
};

export function initialStepStatuses(): Record<FlowStepId, StepStatus> {
  return {
    crash_oracle: "pending",
    health_warning: "pending",
    grace: "pending",
    liquidate: "pending",
  };
}
