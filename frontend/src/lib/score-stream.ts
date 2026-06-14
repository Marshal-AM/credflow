export type SybilNodeRole = "self" | "counterparty" | "defaulter";

export type SybilGraphNode = {
  id: string;
  label: string;
  role: SybilNodeRole;
  tx_count?: number;
  risk?: "low" | "medium" | "high";
};

export type SybilGraphEdge = {
  id: string;
  from: string;
  to: string;
  direction?: "in" | "out" | "peer";
};

export type ScoreStreamEvent =
  | { type: "step"; data: { id: string; status: string; label?: string } }
  | { type: "fetch_result"; data: Record<string, unknown> }
  | { type: "graph_node"; data: SybilGraphNode }
  | { type: "graph_edge"; data: SybilGraphEdge }
  | { type: "graph_meta"; data: Record<string, unknown> }
  | { type: "sybil_result"; data: Record<string, unknown> }
  | { type: "ml_result"; data: Record<string, unknown> }
  | { type: "sub_scores"; data: Record<string, unknown> }
  | { type: "shap"; data: { cid?: string | null } }
  | { type: "score_summary"; data: Record<string, unknown> }
  | { type: "complete"; data: Record<string, unknown> }
  | { type: "awaiting_reclaim"; data: Record<string, unknown> }
  | { type: "persisted"; data: Record<string, unknown> }
  | { type: "error"; data: { message: string } };

export type ScoreStreamResult =
  | { status: "complete"; data: Record<string, unknown>; extras?: Record<string, unknown> }
  | { status: "awaiting_reclaim"; data: Record<string, unknown> }
  | { status: "error"; message: string };

function walletHeaders(wallet: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("x-wallet-address", wallet);
  return { ...init, headers };
}

export async function requestScoreStream(
  wallet: string,
  body: {
    require_reclaim: boolean;
    reclaim_session_id?: string;
    reuse_verified_reclaim?: boolean;
  },
  onEvent: (event: ScoreStreamEvent) => void,
  signal?: AbortSignal
): Promise<ScoreStreamResult> {
  const res = await fetch(
    "/api/score/stream",
    walletHeaders(wallet, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  );

  if (!res.ok) {
    let message = "Scoring failed";
    try {
      const err = await res.json();
      message = err.error || err.detail || message;
    } catch {
      /* ignore */
    }
    return { status: "error", message };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return { status: "error", message: "No response stream" };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: ScoreStreamResult | null = null;
  let streamExtras: Record<string, unknown> | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json) continue;

      try {
        const parsed = JSON.parse(json) as ScoreStreamEvent;
        onEvent(parsed);

        if (parsed.type === "complete") {
          finalResult = { status: "complete", data: parsed.data, extras: streamExtras };
        } else if (parsed.type === "awaiting_reclaim") {
          finalResult = { status: "awaiting_reclaim", data: parsed.data };
        } else if (parsed.type === "persisted") {
          streamExtras = parsed.data;
          if (finalResult?.status === "complete") {
            finalResult = {
              status: "complete",
              data: finalResult.data,
              extras: streamExtras,
            };
          }
        } else if (parsed.type === "error") {
          finalResult = { status: "error", message: parsed.data.message };
        }
      } catch {
        /* skip malformed chunk */
      }
    }
  }

  return (
    finalResult?.status === "complete" && streamExtras && !finalResult.extras
      ? { status: "complete", data: finalResult.data, extras: streamExtras }
      : finalResult
  ) ?? { status: "error", message: "Scoring ended without a result" };
}
