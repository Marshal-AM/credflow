import type { ScoreResponse, ScoreRunRecord } from "@/lib/scoring-api";

export function scoreDataFromLatestRun(
  run: ScoreRunRecord | null | undefined
): ScoreResponse | null {
  const response = run?.response;
  if (!response || typeof response !== "object") return null;
  if (response.status === "complete" || typeof response.cred_score === "number") {
    return response as ScoreResponse;
  }
  return null;
}

/** Same CredScore resolution as AccountDashboard gauge. */
export function resolveDisplayCredScore(input: {
  latestScoreRun?: ScoreRunRecord | Record<string, unknown> | null;
  scoreData?: ScoreResponse | Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
}): number | null {
  const latestRun = input.latestScoreRun as ScoreRunRecord | null | undefined;
  const scoreData = input.scoreData as ScoreResponse | null | undefined;
  const profile = input.profile;

  const scoreResponse =
    (latestRun?.response as ScoreResponse | undefined) ??
    scoreData ??
    undefined;

  const credScore =
    (scoreResponse?.cred_score as number | undefined) ??
    (scoreData?.cred_score as number | undefined) ??
    (profile?.cred_score as number | undefined);

  return typeof credScore === "number" && credScore > 0 ? credScore : null;
}
