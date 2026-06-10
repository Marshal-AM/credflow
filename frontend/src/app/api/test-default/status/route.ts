import { NextResponse } from "next/server";
import { readDefaultTestStatus } from "@/lib/test-default-server";

export async function GET() {
  try {
    const status = await readDefaultTestStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load status" },
      { status: 500 }
    );
  }
}
