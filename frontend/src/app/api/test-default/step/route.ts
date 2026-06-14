import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import {
  triggerCrashOracle,
  triggerGraceExpire,
  triggerGraceStart,
  triggerHealthWarning,
  triggerLiquidate,
  triggerPortfolioMonitor,
  triggerUnblacklist,
} from "@/lib/agent-client";

type Step =
  | "crash_oracle"
  | "health_warning"
  | "portfolio_monitor"
  | "grace_start"
  | "grace_expire"
  | "liquidate"
  | "unblacklist";

export async function POST(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const body = await req.json();
    const step = body.step as Step;
    const loanId = Number(body.loan_id ?? 0);
    const ethPriceUsd = Number(body.eth_price_usd ?? 200);

    let result: { ok: boolean; data?: Record<string, unknown>; error?: string };

    switch (step) {
      case "crash_oracle":
        result = await triggerCrashOracle(wallet, ethPriceUsd);
        break;
      case "health_warning":
        if (!loanId) {
          return NextResponse.json({ error: "loan_id required" }, { status: 400 });
        }
        result = await triggerHealthWarning(wallet, loanId);
        break;
      case "portfolio_monitor":
        result = await triggerPortfolioMonitor(wallet);
        break;
      case "grace_start":
        if (!loanId) {
          return NextResponse.json({ error: "loan_id required" }, { status: 400 });
        }
        result = await triggerGraceStart(wallet, loanId);
        break;
      case "grace_expire":
        if (!loanId) {
          return NextResponse.json({ error: "loan_id required" }, { status: 400 });
        }
        result = await triggerGraceExpire(wallet, loanId);
        break;
      case "liquidate":
        if (!loanId) {
          return NextResponse.json({ error: "loan_id required" }, { status: 400 });
        }
        result = await triggerLiquidate(wallet, loanId, {
          forceGrace: Boolean(body.force_grace),
        });
        break;
      case "unblacklist":
        result = await triggerUnblacklist(wallet);
        break;
      default:
        return NextResponse.json({ error: "Invalid step" }, { status: 400 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Step failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, step, result: result.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Step failed" },
      { status: 500 }
    );
  }
}
