import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { getPublicClient } from "@/lib/loan-server";
import { persistLoanEvent, runPostRepayPipeline } from "@/lib/agent-client";
import { contractsByChain, LENDING_ABI } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";
import { formatEther, formatUnits, type Hash } from "viem";

export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const body = await req.json();
    const chainKey = body.chain_key as ChainKey;
    const txHash = body.tx_hash as Hash | undefined;

    if (!["hub", "arbitrum", "base"].includes(chainKey)) {
      return NextResponse.json({ error: "Invalid chain_key" }, { status: 400 });
    }
    if (!txHash) {
      return NextResponse.json(
        { error: "Missing tx_hash — sign the repay transaction in your wallet first" },
        { status: 400 }
      );
    }

    const cfg = contractsByChain[chainKey];
    if (!cfg.lending) {
      return NextResponse.json({ error: `Lending not deployed on ${cfg.label}` }, { status: 400 });
    }

    const publicClient = getPublicClient(chainKey);
    const lending = cfg.lending as `0x${string}`;
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Repay transaction reverted on-chain" }, { status: 400 });
    }

    const loanId = body.loan_id != null ? BigInt(body.loan_id) : 0n;
    let resolvedLoanId = loanId;
    if (resolvedLoanId === 0n) {
      resolvedLoanId = await publicClient.readContract({
        address: lending,
        abi: LENDING_ABI,
        functionName: "activeLoanId",
        args: [wallet],
      });
    }

    const raw =
      resolvedLoanId > 0n
        ? await publicClient.readContract({
            address: lending,
            abi: LENDING_ABI,
            functionName: "loans",
            args: [resolvedLoanId],
          })
        : null;

    const collateralEth =
      (body.collateral_returned_eth as string | undefined) ??
      (raw ? formatEther(raw.collateralAmount) : "0");
    const totalRepaidFormatted =
      (body.total_repaid as string | undefined) ??
      (raw ? formatUnits(raw.borrowedAmount, 6) : "0");

    await persistLoanEvent({
      wallet,
      chainKey,
      loanId: resolvedLoanId,
      eventType: "repaid",
      borrowAmount: totalRepaidFormatted,
      collateralAmount: collateralEth,
      borrowToken: cfg.borrowSymbol,
      txHash,
      metadata: {
        block_number: receipt.blockNumber.toString(),
        gas_used: receipt.gasUsed.toString(),
      },
    });

    const postRepay = await runPostRepayPipeline({
      wallet,
      chainKey,
      repayTx: txHash,
      loanId: resolvedLoanId.toString(),
    });

    const scoreDelta =
      postRepay.old_score != null && postRepay.new_score != null
        ? postRepay.new_score - postRepay.old_score
        : null;

    return NextResponse.json({
      ok: true,
      chain_key: chainKey,
      repay_tx: txHash,
      loan_id: resolvedLoanId.toString(),
      collateral_returned_eth: collateralEth,
      total_repaid: totalRepaidFormatted,
      borrow_symbol: cfg.borrowSymbol,
      receipt: {
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
      },
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
