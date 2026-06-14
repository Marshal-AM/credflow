import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { fetchDisplayCredScore } from "@/lib/display-cred-score-server";
import { readChainLoanSummary } from "@/lib/loan-server";
import { enrichChainSummaries } from "@/lib/loan-chain-enrich";
import {
  applyBorrowApprovalGate,
  fetchLatestBorrowApproval,
} from "@/lib/borrow-approval";
import {
  filterValidLoanEvents,
  filterValidLzBroadcasts,
} from "@/lib/lz-broadcast";
import {
  repairChainScoreMismatch,
  triggerClearSpokeLoanActive,
  triggerRepairHubLoanLock,
} from "@/lib/agent-client";
import type { ChainKey } from "@/lib/chains";

const CHAINS: ChainKey[] = ["hub", "arbitrum", "base"];

export async function GET(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const [rawSummaries, displayCredScore] = await Promise.all([
      Promise.all(CHAINS.map((k) => readChainLoanSummary(k, wallet))),
      fetchDisplayCredScore(wallet),
    ]);
    const borrowApproval = await fetchLatestBorrowApproval(wallet);
    const summaries = applyBorrowApprovalGate(
      enrichChainSummaries(rawSummaries),
      borrowApproval
    );

    const hub = summaries.find((s) => s.chainKey === "hub");
    const maxSpokeScore = Math.max(
      0,
      ...summaries.filter((s) => s.chainKey !== "hub").map((s) => s.score)
    );
    if (hub && hub.score > 0 && maxSpokeScore > hub.score) {
      void repairChainScoreMismatch(wallet, maxSpokeScore, hub.score).catch(() => {
        /* best-effort hub/spoke score alignment */
      });
    }

    const anyChainHasLoan = summaries.some(
      (s) => s.activeLoanId > 0n || s.loan?.active || s.hasLocalLoan
    );
    const spokeMissingLzLock = summaries.some(
      (s) =>
        s.chainKey !== "hub" &&
        !s.hasLocalLoan &&
        anyChainHasLoan &&
        !s.lzLoanActive
    );
    if (anyChainHasLoan && spokeMissingLzLock) {
      void triggerRepairHubLoanLock(wallet).catch(() => {
        /* repair LZ loan_active to spokes missing mirror */
      });
    }

    const spokeNeedsLzUnlock = summaries.some(
      (s) => s.chainKey !== "hub" && !s.hasLocalLoan && !anyChainHasLoan && s.lzLoanActive
    );
    if (spokeNeedsLzUnlock) {
      void triggerClearSpokeLoanActive(wallet, { force: true }).catch(() => {
        /* hub repaid — broadcast repaid to clear spoke mirrors */
      });
    }

    const supabase = getSupabaseAdmin();
    let loanEvents: unknown[] = [];
    let lzBroadcasts: unknown[] = [];
    let lzBroadcastsHidden = 0;

    if (supabase) {
      const [{ data: events }, { data: broadcasts }] = await Promise.all([
        supabase
          .from("loan_events")
          .select("*")
          .eq("wallet_address", wallet.toLowerCase())
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("layerzero_broadcasts")
          .select("*")
          .eq("wallet_address", wallet.toLowerCase())
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const rawEvents = (events || []) as Array<{ tx_hash: string; event_type: string }>;
      loanEvents = await filterValidLoanEvents(rawEvents);
      const filtered = await filterValidLzBroadcasts(
        (broadcasts || []) as Parameters<typeof filterValidLzBroadcasts>[0]
      );
      lzBroadcasts = filtered.visible;
      lzBroadcastsHidden = filtered.hiddenCount;
    }

    return NextResponse.json({
      wallet,
      displayCredScore,
      chains: summaries.map((s) => ({
        ...s,
        activeLoanId: s.activeLoanId.toString(),
        loan: s.loan
          ? {
              ...s.loan,
              loanId: s.loan.loanId.toString(),
              collateralAmount: s.loan.collateralAmount.toString(),
              borrowedAmount: s.loan.borrowedAmount.toString(),
              interestRate: s.loan.interestRate.toString(),
              startTime: s.loan.startTime.toString(),
              dueTime: s.loan.dueTime.toString(),
              maxLTV: s.loan.maxLTV.toString(),
              interest: s.loan.interest.toString(),
              totalDue: s.loan.totalDue.toString(),
            }
          : null,
      })),
      loan_events: loanEvents,
      layerzero_broadcasts: lzBroadcasts,
      layerzero_broadcasts_hidden: lzBroadcastsHidden,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load loans" },
      { status: 500 }
    );
  }
}
