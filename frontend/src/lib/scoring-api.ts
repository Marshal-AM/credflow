export type ScoreRequestBody = {
  require_reclaim: boolean;
  reclaim_session_id?: string;
};

export type ScoreResponse = Record<string, unknown> & {
  status?: string;
  cred_score?: number;
  ml_cred_score?: number;
  on_chain_cred_score?: number;
  sybil_risk?: string;
  sybil_details?: Record<string, unknown>;
  approved?: boolean;
  rejection_reason?: string;
  reclaim_url?: string;
  reclaim_session_id?: string;
  pipeline?: Record<string, unknown>;
};

export async function fetchWalletAddress(): Promise<string> {
  const res = await fetch("/api/wallet");
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load wallet");
  const data = await res.json();
  return data.address as string;
}

export async function fetchProfile(): Promise<{
  profile: Record<string, unknown> | null;
  wallet: string;
  hasOnChainSbt: boolean;
  onChainScore: number | null;
}> {
  const res = await fetch("/api/profile");
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load profile");
  return res.json();
}

export async function requestScore(body: ScoreRequestBody): Promise<ScoreResponse> {
  const res = await fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : typeof data.error === "string"
          ? data.error
          : "Scoring failed";
    throw new Error(detail);
  }
  return data;
}

export async function pollReclaimSession(sessionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/reclaim/session/${sessionId}`);
  if (!res.ok) throw new Error("Reclaim session poll failed");
  return res.json();
}

export async function mintSbt(scoreSnapshot?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/mint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score_snapshot: scoreSnapshot }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.detail?.reason || "Mint failed");
  return data;
}
