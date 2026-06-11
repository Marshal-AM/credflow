import { NextResponse } from "next/server";
import { getPrepWalletStatus } from "@/lib/prep-wallet-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getPrepWalletStatus());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load prep wallet status" },
      { status: 500 }
    );
  }
}
