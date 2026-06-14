import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { computeRequiredCollateral, readChainLoanSummary } from "@/lib/loan-server";
import {
  assertBorrowApproved,
  fetchLatestBorrowApproval,
} from "@/lib/borrow-approval";
import type { ChainKey } from "@/lib/chains";

export async function GET(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const chainKey = req.nextUrl.searchParams.get("chain_key") as ChainKey;
    const borrowAmount = req.nextUrl.searchParams.get("borrow_amount") ?? "0.5";

    if (!["hub", "arbitrum", "base"].includes(chainKey)) {
      return NextResponse.json({ error: "Invalid chain_key" }, { status: 400 });
    }

    const summary = await readChainLoanSummary(chainKey, wallet);
    const borrowApproval = await fetchLatestBorrowApproval(wallet);
    const approvalBlock = assertBorrowApproved(borrowApproval);
    if (approvalBlock) {
      return NextResponse.json({ error: approvalBlock }, { status: 403 });
    }
    if (summary.score <= 0) {
      return NextResponse.json(
        { error: summary.eligibilityReason || "No score on this chain" },
        { status: 400 }
      );
    }

    const quote = await computeRequiredCollateral(chainKey, summary.score, borrowAmount);
    return NextResponse.json({
      chain_key: chainKey,
      score: summary.score,
      borrow_amount: borrowAmount,
      collateral_eth: quote.collateralEth,
      max_ltv_bps: quote.maxLtvBps,
      max_ltv_pct: quote.maxLtvPct,
      eth_usd: quote.ethUsd,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Quote failed" },
      { status: 500 }
    );
  }
}
