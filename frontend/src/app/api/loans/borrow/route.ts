import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { readChainLoanSummary } from "@/lib/loan-server";
import { enrichChainSummaries } from "@/lib/loan-chain-enrich";
import {
  applyBorrowApprovalGate,
  assertBorrowApproved,
  fetchLatestBorrowApproval,
} from "@/lib/borrow-approval";
import { prepareSpokeBorrow } from "@/lib/spoke-loan-prepare";
import { persistLoanEvent, triggerSyncLoanCreated } from "@/lib/agent-client";
import { contractsByChain } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";
import { writeApiHookRun } from "@/lib/run-file-log";
import { getPublicClient } from "@/lib/loan-server";
import { LENDING_ABI } from "@/lib/contracts";
import type { Hash } from "viem";

export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const body = await req.json();
    const chainKey = body.chain_key as ChainKey;
    const borrowAmount = String(body.borrow_amount ?? "0.5");
    const durationDays = Number(body.duration_days ?? 30);
    const txHash = body.tx_hash as Hash | undefined;
    const collateralEth = body.collateral_eth as string | undefined;

    if (!["hub", "arbitrum", "base"].includes(chainKey)) {
      return NextResponse.json({ error: "Invalid chain_key" }, { status: 400 });
    }
    if (!txHash) {
      return NextResponse.json(
        { error: "Missing tx_hash — sign the borrow transaction in your wallet first" },
        { status: 400 }
      );
    }

    const borrowApproval = await fetchLatestBorrowApproval(wallet);
    const approvalBlock = assertBorrowApproved(borrowApproval);
    if (approvalBlock) {
      return NextResponse.json({ error: approvalBlock }, { status: 403 });
    }

    async function loadSummaries() {
      return applyBorrowApprovalGate(
        enrichChainSummaries(
          await Promise.all(
            (["hub", "arbitrum", "base"] as ChainKey[]).map((k) =>
              readChainLoanSummary(k, wallet)
            )
          )
        ),
        borrowApproval
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

    const publicClient = getPublicClient(chainKey);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Borrow transaction reverted on-chain" }, { status: 400 });
    }

    const cfg = contractsByChain[chainKey];
    const lending = cfg.lending as `0x${string}`;
    const loanId = await publicClient.readContract({
      address: lending,
      abi: LENDING_ABI,
      functionName: "activeLoanId",
      args: [wallet],
    });

    if (loanId === 0n) {
      return NextResponse.json(
        { error: "Borrow tx mined but no active loan was created — try again" },
        { status: 400 }
      );
    }

    await persistLoanEvent({
      wallet,
      chainKey,
      loanId,
      eventType: "created",
      borrowAmount,
      collateralAmount: collateralEth ?? "0",
      borrowToken: cfg.borrowSymbol,
      txHash,
      metadata: { duration_days: durationDays },
    });

    let lzSync: Awaited<ReturnType<typeof triggerSyncLoanCreated>> | null = null;
    if (chainKey === "hub" && loanId > 0n) {
      lzSync = await triggerSyncLoanCreated(wallet, txHash);
    }

    writeApiHookRun({
      hook: "borrow",
      wallet,
      chainKey,
      success: true,
      summary: `borrow on ${chainKey} loan_id=${loanId}`,
      steps: [
        { step: "on_chain_borrow", ok: true, data: { tx_hash: txHash, loan_id: loanId.toString() } },
        {
          step: "lz_sync",
          ok: chainKey !== "hub" || (lzSync?.ok ?? false),
          error: chainKey === "hub" ? lzSync?.error : undefined,
          data: chainKey !== "hub" ? { skipped: "spoke borrow — no LZ agent" } : undefined,
        },
      ],
      payload: { loan_tx: txHash, loan_id: loanId.toString(), lz_sync: lzSync },
    });

    return NextResponse.json({
      ok: true,
      chain_key: chainKey,
      loan_tx: txHash,
      loan_id: loanId.toString(),
      collateral_eth: collateralEth ?? null,
      lz_sync: lzSync,
      agents_triggered: chainKey === "hub" ? ["crosschain_sync"] : [],
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
