import type { LiquidationSnapshot } from "@/lib/supabase-server";

export type { LiquidationSnapshot };

export function parseLiquidationSnapshot(raw: unknown): LiquidationSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const borrower = data.borrower;
  const blacklisted = data.blacklisted;
  if (typeof borrower !== "string" || !Array.isArray(blacklisted)) return null;
  const wallets = blacklisted.filter((a): a is string => typeof a === "string");
  if (!wallets.length) return null;
  return {
    borrower,
    blacklisted: wallets,
    saved_at: typeof data.saved_at === "string" ? data.saved_at : undefined,
  };
}

export function snapshotGraphSummary(snapshot: LiquidationSnapshot | null): string {
  if (!snapshot) return "No linked wallet graph saved.";
  const n = snapshot.blacklisted.length;
  return `${n} blacklisted linked wallet${n === 1 ? "" : "s"}`;
}

/** Shape expected by buildLiquidationGraph. */
export function snapshotToGraphResult(snapshot: LiquidationSnapshot): Record<string, unknown> {
  return {
    borrower: snapshot.borrower,
    blacklisted: snapshot.blacklisted,
    status: "blacklisted",
  };
}
