import { NextRequest, NextResponse } from "next/server";
import { requireRequestWallet } from "@/lib/wallet-request";

export async function GET(req: NextRequest) {
  try {
    const address = requireRequestWallet(req);
    return NextResponse.json({ address });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Wallet not connected" },
      { status: 401 }
    );
  }
}
