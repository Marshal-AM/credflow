import { NextRequest, NextResponse } from "next/server";
import { getFrontendAddress } from "@/lib/wallet-server";
import {
  isPrepWalletStepId,
  runPrepWalletStep,
  type PrepWalletStepId,
} from "@/lib/prep-wallet-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const wallet = getFrontendAddress();
    const body = await req.json();
    const stepId = body.step as PrepWalletStepId;

    if (!stepId || !isPrepWalletStepId(stepId)) {
      return NextResponse.json({ error: "Invalid step" }, { status: 400 });
    }

    const result = await runPrepWalletStep(stepId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Step failed", result },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, step: stepId, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Step failed" },
      { status: 500 }
    );
  }
}
