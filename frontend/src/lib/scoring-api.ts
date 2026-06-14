export type ScoreRequestBody = {
  require_reclaim: boolean;
  reclaim_session_id?: string;
  reuse_verified_reclaim?: boolean;
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

function walletHeaders(wallet: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("x-wallet-address", wallet);
  return { ...init, headers };
}

export type ScoreRunRecord = {
  id?: string;
  status?: string;
  require_reclaim?: boolean;
  reclaim_session_id?: string | null;
  response?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at?: string;
};

export async function fetchProfile(wallet: string): Promise<{
  profile: Record<string, unknown> | null;
  wallet: string;
  hasOnChainSbt: boolean;
  onChainScore: number | null;
  mintTxHash: string | null;
  sbtTokenId: string | null;
  sbtLink: string | null;
  latestScoreRun: ScoreRunRecord | null;
}> {
  const res = await fetch("/api/profile", walletHeaders(wallet));
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load profile");
  return res.json();
}

export async function requestScore(
  wallet: string,
  body: ScoreRequestBody
): Promise<ScoreResponse> {
  const res = await fetch(
    "/api/score",
    walletHeaders(wallet, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
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

export type ReclaimPollResult = {
  ok: boolean;
  status?: string;
  error?: string;
  detail?: string;
  session?: Record<string, unknown>;
};

export async function pollReclaimSession(sessionId: string): Promise<ReclaimPollResult> {
  if (!sessionId) {
    return {
      ok: false,
      error: "missing_session_id",
      detail: "Scoring API did not return reclaim_session_id",
    };
  }

  const res = await fetch(`/api/reclaim/session/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    return {
      ok: false,
      error: "invalid_response",
      detail: "Scoring API returned a non-JSON response — is npm run ml:serve running?",
    };
  }

  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : typeof data.error === "string"
          ? data.error
          : `HTTP ${res.status}`;
    return {
      ok: false,
      error: res.status === 404 ? "session_not_found" : "poll_failed",
      detail,
    };
  }

  return {
    ok: true,
    status: data.status as string | undefined,
    session: data,
  };
}

export async function resetAccountCache(wallet: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    "/api/reset",
    walletHeaders(wallet, { method: "POST" })
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Reset failed");
  return data;
}

export async function mintSbt(
  wallet: string,
  scoreSnapshot?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(
    "/api/mint",
    walletHeaders(wallet, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score_snapshot: scoreSnapshot }),
    })
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.detail?.reason || "Mint failed");
  return data;
}
