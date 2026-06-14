import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { ChainLoanSummary } from "@/lib/loan-server";

export type BorrowApproval = {
  /** null = no Supabase record; rely on on-chain checks only */
  approved: boolean | null;
  rejectionReason: string | null;
};

/** Latest ML borrow gate from score_runs (fallback: account_profiles). */
export async function fetchLatestBorrowApproval(wallet: string): Promise<BorrowApproval> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { approved: null, rejectionReason: null };

  const { data: run } = await supabase
    .from("score_runs")
    .select("response")
    .eq("wallet_address", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const response = run?.response as Record<string, unknown> | undefined;
  if (response && (response.status === "complete" || response.approved != null)) {
    const approved = response.approved !== false;
    return {
      approved,
      rejectionReason: approved
        ? null
        : String(response.rejection_reason || "Not approved for borrowing"),
    };
  }

  const { data: profile } = await supabase
    .from("account_profiles")
    .select("approved, rejection_reason")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();

  if (profile) {
    const approved = profile.approved !== false;
    return {
      approved,
      rejectionReason: approved
        ? null
        : String(profile.rejection_reason || "Not approved for borrowing"),
    };
  }

  return { approved: null, rejectionReason: null };
}

/** Apply ML approval on top of on-chain loan eligibility (same source as dashboard). */
export function applyBorrowApprovalGate<T extends ChainLoanSummary>(
  summaries: T[],
  approval: BorrowApproval
): T[] {
  if (approval.approved !== false) return summaries;

  const reason = approval.rejectionReason || "Not approved for borrowing";

  return summaries.map((s) => {
    if (!s.eligible) return s;
    return {
      ...s,
      eligible: false,
      eligibilityReason: reason,
    };
  });
}

export function assertBorrowApproved(approval: BorrowApproval): string | null {
  if (approval.approved === false) {
    return approval.rejectionReason || "Not approved for borrowing";
  }
  return null;
}
