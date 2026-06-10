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
