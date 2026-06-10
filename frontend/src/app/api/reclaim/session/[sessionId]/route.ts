import { NextRequest, NextResponse } from "next/server";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  if (!sessionId || sessionId === "undefined") {
    return NextResponse.json(
      { detail: "Missing reclaim session id" },
      { status: 400 }
    );
  }
  try {
    const res = await fetch(`${SCORING_API}/reclaim/session/${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        {
          error: "Scoring API returned non-JSON",
          detail: text.slice(0, 200),
        },
        { status: 502 }
      );
    }
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Poll failed",
        detail: "Could not reach scoring API — ensure npm run ml:serve is running on SCORING_API_URL",
      },
      { status: 503 }
    );
  }
}
