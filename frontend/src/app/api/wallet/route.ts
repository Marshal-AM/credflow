import { NextResponse } from "next/server";
import { getFrontendAddress } from "@/lib/wallet-server";

export async function GET() {
  try {
    const address = getFrontendAddress();
    return NextResponse.json({ address });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Wallet config error" },
      { status: 500 }
    );
  }
}
