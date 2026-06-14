import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";
import { readDefaultTestStatus } from "@/lib/test-default-server";

export async function GET(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
    const status = await readDefaultTestStatus(wallet);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load status" },
      { status: 500 }
    );
  }
}
