import { NextRequest, NextResponse } from "next/server";
import { getFrontendAddress } from "@/lib/wallet-server";
import { borrowLoan, readChainLoanSummary } from "@/lib/loan-server";
import { enrichChainSummaries } from "@/lib/loan-chain-enrich";
import { prepareSpokeBorrow } from "@/lib/spoke-loan-prepare";
import { persistLoanEvent, triggerSyncLoanCreated } from "@/lib/agent-client";
import { contractsByChain } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";
import { writeApiHookRun } from "@/lib/run-file-log";

export async function POST(req: NextRequest) {
  try {
    const wallet = getFrontendAddress();
    const body = await req.json();
    const chainKey = body.chain_key as ChainKey;
    const borrowAmount = String(body.borrow_amount ?? "0.5");
    const durationDays = Number(body.duration_days ?? 30);

    if (!["hub", "arbitrum", "base"].includes(chainKey)) {
      return NextResponse.json({ error: "Invalid chain_key" }, { status: 400 });
    }

    async function loadSummaries() {
      return enrichChainSummaries(
        await Promise.all(
          (["hub", "arbitrum", "base"] as ChainKey[]).map((k) =>
            readChainLoanSummary(k, wallet)
          )
        )
      );
    }

    let summaries = await loadSummaries();
    let summary = summaries.find((s) => s.chainKey === chainKey);
    if (!summary) {
      return NextResponse.json({ error: "Unknown chain" }, { status: 400 });
    }

    if (summary.lzLockKind === "lz_clear_pending") {
      await prepareSpokeBorrow(chainKey, wallet);
      summaries = await loadSummaries();
      summary = summaries.find((s) => s.chainKey === chainKey)!;
    }

    if (summary.lzLockKind === "hub_mirror") {
      return NextResponse.json(
        { error: summary.eligibilityReason || "Repay Robinhood hub loan first" },
        { status: 400 }
      );
    }

    if (!summary.eligible) {
      return NextResponse.json(
        { error: summary.eligibilityReason || "Not eligible to borrow" },
        { status: 400 }
      );
    }

    const { txHash, loanId, collateralEth } = await borrowLoan({
      chainKey,
      borrowAmount,
      durationDays,
      score: summary.score,
    });

    const cfg = contractsByChain[chainKey];
    await persistLoanEvent({
      wallet,
      chainKey,
      loanId,
      eventType: "created",
      borrowAmount,
      collateralAmount: collateralEth,
      borrowToken: cfg.borrowSymbol,
      txHash,
      metadata: { duration_days: durationDays },
    });

    let lzSync: Awaited<ReturnType<typeof triggerSyncLoanCreated>> | null = null;
    if (chainKey === "hub" && loanId != null && loanId > 0n) {
      lzSync = await triggerSyncLoanCreated(wallet, txHash);
    }

    writeApiHookRun({
      hook: "borrow",
      wallet,
      chainKey,
      success: true,
      summary: `borrow on ${chainKey} loan_id=${loanId}`,
      steps: [
        { step: "on_chain_borrow", ok: true, data: { tx_hash: txHash, loan_id: loanId?.toString() } },
        {
          step: "lz_sync",
          ok: chainKey !== "hub" || (lzSync?.ok ?? false),
          error: chainKey === "hub" ? lzSync?.error : undefined,
          data: chainKey !== "hub" ? { skipped: "spoke borrow — no LZ agent" } : undefined,
        },
      ],
      payload: { loan_tx: txHash, loan_id: loanId?.toString(), lz_sync: lzSync },
    });

    return NextResponse.json({
      ok: true,
      chain_key: chainKey,
      loan_tx: txHash,
      loan_id: loanId?.toString() ?? null,
      collateral_eth: collateralEth,
      lz_sync: lzSync,
      agents_triggered:
        chainKey === "hub" ? ["crosschain_sync"] : [],
      note:
        chainKey === "hub"
          ? "Hub borrow triggers crosschain_sync (not underwriter). Underwriter runs on score/mint/rescore only."
          : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Borrow failed" },
      { status: 500 }
    );
  }
}
