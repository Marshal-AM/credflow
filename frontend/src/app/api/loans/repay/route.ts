import { NextRequest, NextResponse } from "next/server";
import { getFrontendAddress } from "@/lib/wallet-server";
import { repayLoan } from "@/lib/loan-server";
import { persistLoanEvent, runPostRepayPipeline } from "@/lib/agent-client";
import { contractsByChain } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";
import { writeApiHookRun } from "@/lib/run-file-log";

export async function POST(req: NextRequest) {
  try {
    const wallet = getFrontendAddress();
    const body = await req.json();
    const chainKey = body.chain_key as ChainKey;

    if (!["hub", "arbitrum", "base"].includes(chainKey)) {
      return NextResponse.json({ error: "Invalid chain_key" }, { status: 400 });
    }

    const repay = await repayLoan(chainKey);
    const { txHash, loanId } = repay;
    const cfg = contractsByChain[chainKey];

    await persistLoanEvent({
      wallet,
      chainKey,
      loanId,
      eventType: "repaid",
      borrowAmount: repay.totalRepaidFormatted,
      collateralAmount: repay.collateralEth,
      borrowToken: cfg.borrowSymbol,
      txHash,
      metadata: {
        collateral_wei: repay.collateralWei.toString(),
        total_repaid_wei: repay.totalRepaidWei.toString(),
        block_number: repay.receipt.blockNumber,
        gas_used: repay.receipt.gasUsed,
      },
    });

    const postRepay = await runPostRepayPipeline({
      wallet,
      chainKey,
      repayTx: txHash,
      loanId: loanId.toString(),
    });

    const scoreDelta =
      postRepay.old_score != null && postRepay.new_score != null
        ? postRepay.new_score - postRepay.old_score
        : null;

    writeApiHookRun({
      hook: "repay",
      wallet,
      chainKey,
      success: postRepay.errors.length === 0,
      summary: `repay on ${chainKey} score ${postRepay.old_score}→${postRepay.new_score}`,
      steps: [
        {
          step: "on_chain_repay",
          ok: true,
          data: {
            tx_hash: txHash,
            loan_id: loanId.toString(),
            collateral_returned_eth: repay.collateralEth,
            total_repaid: `${repay.totalRepaidFormatted} ${repay.borrowSymbol}`,
            block_number: repay.receipt.blockNumber,
            gas_used: repay.receipt.gasUsed,
          },
        },
        { step: "ml_rescore", ok: postRepay.score?.ok ?? false, error: postRepay.score?.error },
        {
          step: "underwriter_rescore",
          ok: postRepay.underwrite?.ok ?? false,
          error: postRepay.underwrite?.error,
          data: postRepay.underwrite?.data as Record<string, unknown> | undefined,
        },
        {
          step: "lz_sync_repaid",
          ok: postRepay.lz_sync?.ok ?? false,
          error: postRepay.lz_sync?.error,
        },
        { step: "supabase_profile", ok: postRepay.supabase_saved },
      ],
      payload: {
        repay_tx: txHash,
        collateral_returned_eth: repay.collateralEth,
        total_repaid: `${repay.totalRepaidFormatted} ${repay.borrowSymbol}`,
        receipt: repay.receipt,
        old_score: postRepay.old_score,
        new_score: postRepay.new_score,
        score_delta: scoreDelta,
        errors: postRepay.errors,
      },
      error: postRepay.errors.length ? postRepay.errors.join("; ") : undefined,
    });

    return NextResponse.json({
      ok: true,
      chain_key: chainKey,
      repay_tx: txHash,
      loan_id: loanId.toString(),
      collateral_returned_eth: repay.collateralEth,
      total_repaid: repay.totalRepaidFormatted,
      borrow_symbol: repay.borrowSymbol,
      receipt: repay.receipt,
      old_score: postRepay.old_score,
      new_score: postRepay.new_score,
      score_delta: scoreDelta,
      post_repay: postRepay,
      lz_sync: postRepay.lz_sync,
      underwrite: postRepay.underwrite,
      errors: postRepay.errors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Repay failed" },
      { status: 500 }
    );
  }
}
