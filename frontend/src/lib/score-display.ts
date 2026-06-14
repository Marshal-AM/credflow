/** Score to mint/rescore on hub SBT — ML output unless reclaim formula applies. */
export function underwriteTargetScore(scoreData: Record<string, unknown>): number | null {
  const hasReclaim =
    Boolean(scoreData.reclaim) ||
    Boolean(scoreData.reclaim_proof_hash) ||
    (Boolean(scoreData.reclaim_session_id) && scoreData.require_reclaim === true);
  if (hasReclaim) {
    const formula = scoreData.on_chain_cred_score ?? scoreData.cred_score;
    return typeof formula === "number" ? formula : null;
  }
  const ml = scoreData.ml_cred_score;
  if (typeof ml === "number") return ml;
  const cred = scoreData.cred_score;
  return typeof cred === "number" ? cred : null;
}

/** True when a completed score run should trigger hub SBT mint/rescore. */
export function scoreMeetsUnderwriteCriteria(scoreData: Record<string, unknown>): boolean {
  if (scoreData.status !== "complete") return false;
  const sybil = String(scoreData.sybil_risk ?? "low").toLowerCase();
  if (sybil === "high") return false;
  const score = underwriteTargetScore(scoreData);
  return score != null && score > 500;
}

/** Normalize snapshot for underwriter — strip display floor, set authoritative cred fields. */
export function snapshotForUnderwrite(
  scoreData: Record<string, unknown>
): Record<string, unknown> {
  const target = underwriteTargetScore(scoreData);
  if (target == null) return scoreData;
  return {
    ...scoreData,
    cred_score: target,
    on_chain_cred_score: target,
    approved: true,
    floor_cred_score: undefined,
    score_floored: false,
  };
}

/** Align cached ML / formula fields with live on-chain SBT when hub score is authoritative. */
export function applyOnChainScore<T extends Record<string, unknown>>(
  scoreData: T,
  onChainScore: number | null | undefined,
  hasOnChainSbt: boolean
): T {
  if (!hasOnChainSbt || onChainScore == null || onChainScore <= 0) {
    return scoreData;
  }
  const ml = scoreData.ml_cred_score as number | undefined;
  const staleMl = ml == null || ml < onChainScore;
  const formula = scoreData.on_chain_cred_score as number | undefined;
  const staleFormula = formula == null || formula < onChainScore;

  return {
    ...scoreData,
    cred_score: onChainScore,
    ...(staleMl ? { ml_cred_score: onChainScore } : {}),
    ...(staleFormula ? { on_chain_cred_score: onChainScore } : {}),
  };
}

export function patchScoreSnapshot(
  snapshot: unknown,
  onChainScore: number
): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const snap = snapshot as Record<string, unknown>;
  const ml = Number(snap.ml_cred_score);
  const cred = Number(snap.cred_score);
  if (
    !Number.isNaN(ml) &&
    ml >= onChainScore &&
    !Number.isNaN(cred) &&
    cred >= onChainScore
  ) {
    return snap;
  }
  return {
    ...snap,
    cred_score: onChainScore,
    ml_cred_score: onChainScore,
    on_chain_cred_score: onChainScore,
  };
}
