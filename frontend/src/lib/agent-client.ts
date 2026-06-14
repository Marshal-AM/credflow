import { getSupabaseAdmin, profileFromScoreResponse } from "@/lib/supabase-server";
import { underwriteTargetScore } from "@/lib/score-display";
import type { ChainKey } from "@/lib/chains";
import { isChainTxSuccessful } from "@/lib/lz-broadcast";

const SCORING_API = process.env.SCORING_API_URL || "http://localhost:8000";
const SCORE_FETCH_TIMEOUT_MS = Number(
  process.env.SCORING_FETCH_TIMEOUT_MS || "600000"
);

export type PostRepayPipelineResult = {
  old_score: number | null;
  new_score: number | null;
  score: { ok: boolean; data?: Record<string, unknown>; error?: string } | null;
  underwrite: { ok: boolean; data?: Record<string, unknown>; error?: string } | null;
  lz_sync: { ok: boolean; data?: Record<string, unknown>; error?: string } | null;
  supabase_saved: boolean;
  errors: string[];
};

export type HubTxHash = {
  chain_key: string;
  eid: number;
  tx_hash: string;
  type?: string;
};

export async function persistLzBroadcast(params: {
  wallet: string;
  triggerSource: string;
  messageType: string;
  hubScore?: number;
  hubTxHashes: HubTxHash[];
  relatedOnchainTx?: string;
  errorMessage?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("layerzero_broadcasts")
    .insert({
      wallet_address: params.wallet.toLowerCase(),
      trigger_source: params.triggerSource,
      message_type: params.messageType,
      hub_score: params.hubScore ?? null,
      hub_tx_hashes: params.hubTxHashes,
      related_onchain_tx: params.relatedOnchainTx ?? null,
      error_message: params.errorMessage ?? null,
      status: params.errorMessage ? "failed" : "submitted",
    })
    .select()
    .single();
  if (error) return null;
  return data;
}

export async function persistLoanEvent(params: {
  wallet: string;
  chainKey: string;
  loanId?: bigint | number | null;
  eventType: "created" | "repaid";
  borrowAmount?: string;
  collateralAmount?: string;
  borrowToken?: string;
  txHash: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("loan_events")
    .insert({
      wallet_address: params.wallet.toLowerCase(),
      chain_key: params.chainKey,
      loan_id: params.loanId != null ? Number(params.loanId) : null,
      event_type: params.eventType,
      borrow_amount: params.borrowAmount ?? null,
      collateral_amount: params.collateralAmount ?? null,
      borrow_token: params.borrowToken ?? null,
      tx_hash: params.txHash,
      metadata: params.metadata ?? null,
    })
    .select()
    .single();
  if (error) return null;
  return data;
}

async function callAgent<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${SCORING_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data.detail;
      const reason =
        typeof detail === "object" && detail !== null
          ? (detail as { reason?: string }).reason || JSON.stringify(detail)
          : detail || JSON.stringify(data);
      return { ok: false, error: String(reason) };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Agent call failed" };
  }
}

export type AutoUnderwriteResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  data?: Record<string, unknown>;
  error?: string;
};

/** Mint or update hub SBT from a completed score snapshot (no extra scoring API call). */
export async function autoUnderwriteAfterScore(
  wallet: string,
  scoreData: Record<string, unknown>,
  options?: {
    reclaimSessionId?: string | null;
    hasOnChainProfile?: boolean;
  }
): Promise<AutoUnderwriteResult> {
  const { scoreMeetsUnderwriteCriteria, snapshotForUnderwrite } = await import(
    "@/lib/score-display"
  );

  if (scoreData.status !== "complete") {
    return { ok: false, skipped: true, reason: "score_incomplete" };
  }
  if (!scoreMeetsUnderwriteCriteria(scoreData)) {
    return { ok: false, skipped: true, reason: "criteria_not_met" };
  }

  const snapshot = snapshotForUnderwrite(scoreData);

  const { hubHasSbtProfile, fetchSbtMintTxHash } = await import("@/lib/sbt-chain");
  const hasProfile =
    options?.hasOnChainProfile ??
    (await hubHasSbtProfile(wallet as `0x${string}`));

  const reclaimSessionId =
    options?.reclaimSessionId ??
    (typeof scoreData.reclaim_session_id === "string"
      ? scoreData.reclaim_session_id
      : null);

  const underwrite = await callAgent<{
    action?: string;
    onchain?: string;
    tx?: string;
    cred_score?: number;
    score?: number;
    run_id?: string;
  }>("/agents/underwrite", {
    wallet_address: wallet,
    rescore: hasProfile,
    reclaim_session_id: reclaimSessionId,
    score_snapshot: snapshot,
    trigger_source: "api_hook",
    trigger_event: hasProfile ? "score_rescore" : "score_mint",
  });

  if (!underwrite.ok) {
    const supabase = getSupabaseAdmin();
    if (supabase) {
      await supabase
        .from("account_profiles")
        .update({ mint_status: "failed", updated_at: new Date().toISOString() })
        .eq("wallet_address", wallet.toLowerCase());
    }
    return { ok: false, error: underwrite.error };
  }

  const data = underwrite.data ?? {};
  const action = data.action as string | undefined;
  const credScore =
    typeof data.cred_score === "number"
      ? data.cred_score
      : typeof data.score === "number"
        ? data.score
        : typeof scoreData.cred_score === "number"
          ? (scoreData.cred_score as number)
          : null;

  let txHash = (data.tx as string | undefined) || null;
  if (!txHash && action !== "skip" && credScore != null) {
    txHash = await fetchSbtMintTxHash(wallet as `0x${string}`);
  }

  const supabase = getSupabaseAdmin();
  if (supabase && credScore != null) {
    const onchain = data.onchain as string | undefined;
    const mintedNow = onchain === "mintSBT" || onchain === "mintScore";
    await supabase
      .from("account_profiles")
      .update({
        ...(mintedNow && txHash
          ? { mint_tx_hash: txHash, minted_at: new Date().toISOString() }
          : {}),
        mint_status: "minted",
        sbt_score_on_chain: credScore,
        cred_score: credScore,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet_address", wallet.toLowerCase());
  }

  return { ok: true, data: { ...data, tx: txHash, cred_score: credScore } };
}

export async function triggerSyncScore(
  wallet: string,
  score: number,
  triggerSource = "api_hook",
  triggerEvent = "score_complete"
) {
  const result = await callAgent<{
    hub_tx_hashes: HubTxHash[];
    run_id?: string;
  }>("/agents/sync-score", {
    wallet_address: wallet,
    score,
    trigger_source: triggerSource,
    trigger_event: triggerEvent,
  });
  if (result.ok && result.data) {
    await persistLzBroadcast({
      wallet,
      triggerSource,
      messageType: "score",
      hubScore: score,
      hubTxHashes: result.data.hub_tx_hashes || [],
    });
  }
  return result;
}

const LZ_CLEAR_COOLDOWN_MS = 60 * 1000;
const lzClearGuards = new Map<string, { at: number; inFlight: boolean }>();

/** Clear OApp loanActiveMirror on spokes when hub loan is already repaid. */
export async function triggerClearSpokeLoanActive(
  wallet: string,
  options?: { force?: boolean }
) {
  const key = wallet.toLowerCase();
  const now = Date.now();
  const guard = lzClearGuards.get(key);
  if (guard?.inFlight) {
    return { ok: false, error: "lz_clear_in_flight" };
  }
  if (!options?.force && guard && now - guard.at < LZ_CLEAR_COOLDOWN_MS) {
    return { ok: false, error: "lz_clear_cooldown" };
  }
  lzClearGuards.set(key, { at: now, inFlight: true });
  const result = await callAgent<{
    hub_tx_hashes: HubTxHash[];
    run_id?: string;
  }>("/agents/sync-loan", {
    wallet_address: wallet,
    event: "repaid",
    repair_stale: true,
    trigger_source: "api_hook",
    trigger_event: "stale_loan_flag_clear",
  });
  try {
    if (result.ok && result.data) {
      await persistLzBroadcast({
        wallet,
        triggerSource: "stale_loan_flag_clear",
        messageType: "repaid",
        hubTxHashes: result.data.hub_tx_hashes || [],
      });
    }
    return result;
  } finally {
    lzClearGuards.set(key, { at: Date.now(), inFlight: false });
  }
}

export async function triggerSyncLoanCreated(
  wallet: string,
  relatedTx: string,
  chainKey: ChainKey = "hub"
) {
  if (!(await isChainTxSuccessful(chainKey, relatedTx))) {
    return {
      ok: false,
      error: `Borrow tx reverted on ${chainKey} — LayerZero loan_active sync skipped`,
    };
  }
  const triggerEvent =
    chainKey === "hub" ? "loan_created" : `loan_created_${chainKey}`;
  return triggerSyncHubLoanActive(wallet, relatedTx, triggerEvent);
}

/** Re-broadcast hub loan_active to spokes (e.g. Base missed LZ while Arbitrum received it). */
export async function triggerRepairHubLoanLock(wallet: string) {
  return triggerSyncHubLoanActive(wallet, undefined, "hub_loan_lock_repair");
}

async function triggerSyncHubLoanActive(
  wallet: string,
  relatedTx: string | undefined,
  triggerEvent: string
) {
  const result = await callAgent<{
    hub_tx_hashes: HubTxHash[];
    score?: number;
    run_id?: string;
  }>("/agents/sync-loan", {
    wallet_address: wallet,
    event: "created",
    trigger_source: "api_hook",
    trigger_event: triggerEvent,
  });
  if (result.ok && result.data) {
    await persistLzBroadcast({
      wallet,
      triggerSource: triggerEvent,
      messageType: "loan_active",
      hubScore: result.data.score,
      hubTxHashes: result.data.hub_tx_hashes || [],
      relatedOnchainTx: relatedTx,
    });
  }
  return result;
}

export async function triggerSyncLoanRepaid(
  wallet: string,
  relatedTx: string,
  score?: number,
  chainKey: ChainKey = "hub"
) {
  if (!(await isChainTxSuccessful(chainKey, relatedTx))) {
    return {
      ok: false,
      error: `Repay tx reverted on ${chainKey} — LayerZero repaid sync skipped`,
    };
  }
  const body: Record<string, unknown> = {
    wallet_address: wallet,
    event: "repaid",
    trigger_source: "api_hook",
    trigger_event: "loan_repaid",
  };
  if (typeof score === "number") {
    body.score = score;
  }
  const result = await callAgent<{
    hub_tx_hashes: HubTxHash[];
    score?: number;
    run_id?: string;
  }>("/agents/sync-loan", body);
  if (result.ok && result.data) {
    await persistLzBroadcast({
      wallet,
      triggerSource: "loan_repaid",
      messageType: "repaid",
      hubScore: result.data.score,
      hubTxHashes: result.data.hub_tx_hashes || [],
      relatedOnchainTx: relatedTx,
    });
  }
  return result;
}

export async function triggerUnderwriteRescore(
  wallet: string,
  options?: {
    scoreSnapshot?: Record<string, unknown>;
    repayChain?: ChainKey;
    repayTx?: string;
    loanId?: number | string | null;
    triggerEvent?: string;
  }
) {
  const body: Record<string, unknown> = {
    wallet_address: wallet,
    rescore: true,
    trigger_source: "api_hook",
    trigger_event: options?.triggerEvent ?? "loan_repaid",
  };
  if (options?.scoreSnapshot) body.score_snapshot = options.scoreSnapshot;
  if (options?.repayChain) body.repay_chain = options.repayChain;
  if (options?.repayTx) body.repay_tx = options.repayTx;
  if (options?.loanId != null) body.loan_id = Number(options.loanId);
  return callAgent<{
    cred_score?: number;
    tx?: string;
    run_id?: string;
    onchain?: string;
  }>("/agents/underwrite", body);
}

async function requestPostRepayScore(
  wallet: string,
  options: {
    requireReclaim: boolean;
    floorScore?: number | null;
    storedBalanceUsdCents?: number | null;
    storedReclaimProofHash?: string | null;
  }
) {
  const body: Record<string, unknown> = {
    wallet_address: wallet,
    require_reclaim: options.requireReclaim,
    reuse_verified_reclaim: options.requireReclaim,
  };
  if (options.floorScore != null) {
    body.floor_cred_score = options.floorScore;
  }
  if (options.storedBalanceUsdCents != null && options.storedBalanceUsdCents > 0) {
    body.stored_balance_usd_cents = options.storedBalanceUsdCents;
  }
  if (options.storedReclaimProofHash) {
    body.stored_reclaim_proof_hash = options.storedReclaimProofHash;
  }
  const res = await fetch(`${SCORING_API}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SCORE_FETCH_TIMEOUT_MS),
  });
  const data = await res.json();
  return { res, data };
}

const REPAIR_COOLDOWN_MS = 15 * 60 * 1000;
const repairGuards = new Map<string, { at: number; inFlight: boolean }>();

export async function repairChainScoreMismatch(
  wallet: string,
  targetScore: number,
  hubScore: number
) {
  const key = wallet.toLowerCase();
  const now = Date.now();
  const guard = repairGuards.get(key);

  if (guard?.inFlight) {
    return { ok: false, error: "repair_in_flight" };
  }
  if (guard && now - guard.at < REPAIR_COOLDOWN_MS) {
    return { ok: false, error: "repair_cooldown" };
  }

  repairGuards.set(key, { at: now, inFlight: true });
  try {
    if (hubScore >= targetScore) {
      return triggerSyncScore(wallet, targetScore, "api_hook", "score_repair");
    }

    const supabase = getSupabaseAdmin();
    let borrowSub = 60;
    let walletSub = 90;
    let shapCid = "ipfs://repair";
    if (supabase) {
      const { data } = await supabase
        .from("account_profiles")
        .select("borrow_sub_score, wallet_sub_score, shap_cid")
        .eq("wallet_address", wallet.toLowerCase())
        .maybeSingle();
      if (typeof data?.borrow_sub_score === "number") borrowSub = data.borrow_sub_score;
      if (typeof data?.wallet_sub_score === "number") walletSub = data.wallet_sub_score;
      if (typeof data?.shap_cid === "string" && data.shap_cid) shapCid = data.shap_cid;
    }
    const snapshot: Record<string, unknown> = {
      status: "complete",
      cred_score: targetScore,
      on_chain_cred_score: targetScore,
      floor_cred_score: targetScore,
      approved: true,
      sybil_risk: "medium",
      borrow_sub_score: borrowSub,
      wallet_sub_score: walletSub,
      shap_cid: shapCid,
      default_prob_bps: 200,
      balance_usd_cents: 0,
    };
    const underwrite = await triggerUnderwriteRescore(wallet, {
      scoreSnapshot: snapshot,
      triggerEvent: "score_repair",
    });
    if (underwrite.ok) {
      await triggerSyncScore(wallet, targetScore, "api_hook", "score_repair");
      if (supabase) {
        const { data: existing } = await supabase
          .from("account_profiles")
          .select("score_snapshot")
          .eq("wallet_address", wallet.toLowerCase())
          .maybeSingle();
        const { patchScoreSnapshot } = await import("@/lib/score-display");
        const patchedSnapshot = patchScoreSnapshot(
          existing?.score_snapshot,
          targetScore
        );
        await supabase
          .from("account_profiles")
          .update({
            cred_score: targetScore,
            ml_cred_score: targetScore,
            on_chain_cred_score: targetScore,
            sbt_score_on_chain: targetScore,
            ...(patchedSnapshot ? { score_snapshot: patchedSnapshot } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("wallet_address", wallet.toLowerCase());
      }
    }
    return underwrite;
  } finally {
    repairGuards.set(key, { at: Date.now(), inFlight: false });
  }
}

export async function runPostRepayPipeline(params: {
  wallet: string;
  chainKey: ChainKey;
  repayTx: string;
  loanId?: number | string | null;
}): Promise<PostRepayPipelineResult> {
  const { wallet, chainKey, repayTx, loanId } = params;
  const errors: string[] = [];
  const supabase = getSupabaseAdmin();

  let oldScore: number | null = null;
  let storedBalanceUsdCents: number | null = null;
  let storedReclaimProofHash: string | null = null;
  if (supabase) {
    const { data } = await supabase
      .from("account_profiles")
      .select("cred_score, balance_usd_cents, reclaim, score_snapshot")
      .eq("wallet_address", wallet.toLowerCase())
      .maybeSingle();
    if (typeof data?.cred_score === "number") {
      oldScore = data.cred_score;
    }
    if (typeof data?.balance_usd_cents === "number" && data.balance_usd_cents > 0) {
      storedBalanceUsdCents = data.balance_usd_cents;
    }
    const reclaim = data?.reclaim as Record<string, unknown> | null | undefined;
    if (typeof reclaim?.reclaim_proof_hash === "string") {
      storedReclaimProofHash = reclaim.reclaim_proof_hash;
    }
    const snap = data?.score_snapshot as Record<string, unknown> | null | undefined;
    if (!storedReclaimProofHash && typeof snap?.reclaim_proof_hash === "string") {
      storedReclaimProofHash = snap.reclaim_proof_hash;
    }
  }

  let scoreResult: PostRepayPipelineResult["score"] = null;
  let scoreSnapshot: Record<string, unknown> | undefined;
  let newScore: number | null = null;

  try {
    let { res, data } = await requestPostRepayScore(wallet, {
      requireReclaim: true,
      floorScore: oldScore,
      storedBalanceUsdCents,
      storedReclaimProofHash,
    });
    if (data.status === "awaiting_reclaim" || !res.ok) {
      ({ res, data } = await requestPostRepayScore(wallet, {
        requireReclaim: false,
        floorScore: oldScore,
        storedBalanceUsdCents,
        storedReclaimProofHash,
      }));
    }
    if (!res.ok) {
      const err = data.detail || JSON.stringify(data);
      errors.push(`score: ${err}`);
      scoreResult = { ok: false, error: String(err) };
    } else {
      scoreResult = { ok: true, data };
      if (data.status === "complete") {
        scoreSnapshot = data as Record<string, unknown>;
        if (typeof data.cred_score === "number") {
          newScore = data.cred_score;
        }
      } else {
        errors.push(`score: status=${data.status}`);
      }
      if (supabase) {
        await supabase.from("score_runs").insert({
          wallet_address: wallet.toLowerCase(),
          status: data.status || "unknown",
          require_reclaim: Boolean(data.reclaim),
          response: data,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Score request failed";
    errors.push(`score: ${msg}`);
    scoreResult = { ok: false, error: msg };
  }

  const underwrite: AutoUnderwriteResult =
    scoreSnapshot?.status === "complete"
      ? await autoUnderwriteAfterScore(wallet, scoreSnapshot)
      : { ok: false, skipped: true, reason: "score_incomplete" };

  if (underwrite.skipped) {
    if (underwrite.reason === "score_incomplete") {
      errors.push("underwrite: skipped — post-repay score did not complete");
    }
  } else if (!underwrite.ok) {
    errors.push(`underwrite: ${underwrite.error}`);
  } else if (typeof underwrite.data?.cred_score === "number") {
    newScore = underwrite.data.cred_score;
  }

  const lzScore =
    underwrite.data?.cred_score ??
    (scoreSnapshot ? underwriteTargetScore(scoreSnapshot) : null) ??
    newScore ??
    undefined;
  let lz_sync = await triggerSyncLoanRepaid(
    wallet,
    repayTx,
    typeof lzScore === "number" ? lzScore : undefined,
    chainKey
  );
  if (!lz_sync.ok) {
    errors.push(`lz_sync: ${lz_sync.error}`);
    const fallback = await triggerClearSpokeLoanActive(wallet);
    if (fallback.ok) {
      lz_sync = fallback;
    } else if (fallback.error !== "lz_clear_cooldown" && fallback.error !== "lz_clear_in_flight") {
      errors.push(`lz_clear: ${fallback.error}`);
    }
  } else if (chainKey === "hub") {
    void triggerClearSpokeLoanActive(wallet).catch(() => {
      /* belt-and-suspenders spoke unlock after hub repay */
    });
  }

  let supabaseSaved = false;
  if (supabase && scoreSnapshot && scoreResult?.ok) {
    const profile = profileFromScoreResponse(wallet, scoreSnapshot);
    const chainScore =
      typeof underwrite.data?.cred_score === "number"
        ? underwrite.data.cred_score
        : underwriteTargetScore(scoreSnapshot) ?? profile.cred_score;
    const { error } = await supabase.from("account_profiles").upsert({
      ...profile,
      ...(typeof chainScore === "number"
        ? {
            cred_score: chainScore,
            on_chain_cred_score: chainScore,
            sbt_score_on_chain: chainScore,
          }
        : {}),
    });
    if (error) {
      errors.push(`supabase: ${error.message}`);
    } else {
      supabaseSaved = true;
    }
  }

  return {
    old_score: oldScore,
    new_score: newScore,
    score: scoreResult,
    underwrite,
    lz_sync,
    supabase_saved: supabaseSaved,
    errors,
  };
}

async function callTestDefaultAgent<T>(
  path: string,
  wallet: string,
  body: Record<string, unknown>
) {
  return callAgent<T>(path, {
    wallet_address: wallet,
    trigger_source: "test_default_ui",
    ...body,
  });
}

export async function triggerCrashOracle(wallet: string, ethPriceUsd: number) {
  return callTestDefaultAgent<{
    eth_price_usd: number;
    set_price_tx: string;
    run_id?: string;
  }>("/agents/crash-oracle", wallet, { eth_price_usd: ethPriceUsd });
}

export async function triggerHealthWarning(wallet: string, loanId: number) {
  return callTestDefaultAgent<{
    loan_id: number;
    ltv_bps: number;
    health_warning_tx: string;
    run_id?: string;
  }>("/agents/health-warning", wallet, { loan_id: loanId });
}

export async function triggerGraceStart(wallet: string, loanId: number) {
  return callTestDefaultAgent<{ loan_id: number; status: string; run_id?: string }>(
    "/agents/grace-start",
    wallet,
    { loan_id: loanId }
  );
}

export async function triggerGraceExpire(wallet: string, loanId: number) {
  return callTestDefaultAgent<{ loan_id: number; status: string; run_id?: string }>(
    "/agents/grace-expire",
    wallet,
    { loan_id: loanId }
  );
}

export async function triggerLiquidate(
  wallet: string,
  loanId: number,
  options?: { forceGrace?: boolean }
) {
  return callTestDefaultAgent<{
    status: string;
    liquidate_tx?: string;
    blacklist_tx?: string;
    lz_broadcast_tx?: Array<{ chain_key: string; tx_hash: string }>;
    run_id?: string;
  }>("/agents/liquidate", wallet, {
    loan_id: loanId,
    chain: "hub",
    force_grace: options?.forceGrace ?? false,
  });
}

export async function triggerUnblacklist(wallet: string) {
  return callTestDefaultAgent<{
    status: string;
    whitelist_tx?: string;
    unblacklist_tx?: string;
    was_blacklisted?: boolean;
    default_count_before?: number;
    default_count_after?: number;
    is_blacklisted?: boolean;
    lz_whitelist_tx?: Array<{ chain_key: string; tx_hash: string }>;
    spoke_clear_tx?: Array<{ chain_key: string; tx_hash: string }>;
    run_id?: string;
  }>("/agents/unblacklist", wallet, { trigger_event: "whitelist_wallet" });
}

export async function triggerPortfolioMonitor(wallet: string) {
  return callAgent<{ loans: unknown[]; run_id?: string }>("/agents/monitor", {
    wallet_address: wallet,
    trigger_source: "test_default_ui",
    trigger_event: "portfolio_monitor",
  });
}
