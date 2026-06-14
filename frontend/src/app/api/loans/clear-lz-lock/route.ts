import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { readChainLoanSummary } from "@/lib/loan-server";
import { enrichChainSummaries } from "@/lib/loan-chain-enrich";
import { prepareSpokeBorrow } from "@/lib/spoke-loan-prepare";
import type { ChainKey } from "@/lib/chains";

/** Clear OApp loanActive mirror when hub has no loan (not hub-mirror lock). */
export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const body = await req.json();
    const chainKey = body.chain_key as ChainKey;

    if (!["arbitrum", "base"].includes(chainKey)) {
      return NextResponse.json({ error: "chain_key must be arbitrum or base" }, { status: 400 });
    }

    const summaries = enrichChainSummaries(
      await Promise.all(
        (["hub", "arbitrum", "base"] as ChainKey[]).map((k) =>
          readChainLoanSummary(k, wallet)
        )
      )
    );
    const spoke = summaries.find((s) => s.chainKey === chainKey);
    if (!spoke) {
      return NextResponse.json({ error: "Unknown chain" }, { status: 400 });
    }

    if (spoke.lzLockKind === "hub_mirror") {
      return NextResponse.json(
        {
          error:
            "Cannot clear — you have an active loan on Robinhood hub. Repay there first; this spoke lock is intentional.",
        },
        { status: 400 }
      );
    }

    if (spoke.lzLockKind !== "lz_clear_pending") {
      return NextResponse.json({ ok: true, message: "No LayerZero unlock pending on this chain" });
    }

    await prepareSpokeBorrow(chainKey, wallet);
    const after = enrichChainSummaries(
      await Promise.all(
        (["hub", "arbitrum", "base"] as ChainKey[]).map((k) =>
          readChainLoanSummary(k, wallet)
        )
      )
    );

    return NextResponse.json({
      ok: true,
      chain_key: chainKey,
      cleared: !after.find((s) => s.chainKey === chainKey)?.lzLoanActive,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Clear failed" },
      { status: 500 }
    );
  }
}
