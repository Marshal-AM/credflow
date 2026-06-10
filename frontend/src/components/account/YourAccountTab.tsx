"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountDashboard } from "@/components/account/AccountDashboard";
import { BuildScoreModal } from "@/components/account/BuildScoreModal";
import { ScoringProgress } from "@/components/account/ScoringProgress";
import { ScoreCompleteModal } from "@/components/account/ScoreCompleteModal";
import {
  fetchProfile,
  mintSbt,
  pollReclaimSession,
  requestScore,
  type ScoreResponse,
} from "@/lib/scoring-api";
import { applyOnChainScore } from "@/lib/score-display";

type Phase = "loading" | "empty" | "scoring" | "reclaim" | "complete" | "error";

function hasCompleteScoreSnapshot(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile) return false;
  const snap = profile.score_snapshot as ScoreResponse | undefined;
  return snap?.status === "complete" || profile.cred_score != null;
}

function profileToScoreData(profile: Record<string, unknown>): ScoreResponse {
  const snap = profile.score_snapshot as ScoreResponse | undefined;
  if (snap?.status === "complete") return snap;
  return {
    status: "complete",
    cred_score: profile.cred_score as number,
    ml_cred_score: profile.ml_cred_score as number,
    on_chain_cred_score: profile.on_chain_cred_score as number,
    borrow_sub_score: profile.borrow_sub_score as number,
    wallet_sub_score: profile.wallet_sub_score as number,
    sybil_risk: profile.sybil_risk as string,
    sybil_details: profile.sybil_details as Record<string, unknown>,
    balance_usd_cents: profile.balance_usd_cents as number,
    approved: profile.approved as boolean,
    rejection_reason: profile.rejection_reason as string,
    shap_cid: profile.shap_cid as string,
    reclaim: profile.reclaim as Record<string, unknown>,
    model_breakdown: profile.model_breakdown as Record<string, unknown>,
  };
}

export function YourAccountTab() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [wallet, setWallet] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [scoreData, setScoreData] = useState<ScoreResponse | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [hasOnChainSbt, setHasOnChainSbt] = useState(false);
  const [onChainScore, setOnChainScore] = useState<number | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletTrack, setWalletTrack] = useState<"idle" | "running" | "done" | "error">("idle");
  const [sybilTrack, setSybilTrack] = useState<"idle" | "running" | "done" | "error">("idle");
  const [reclaimTrack, setReclaimTrack] = useState<"idle" | "running" | "done" | "error">("idle");
  const [minting, setMinting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [hasCachedScore, setHasCachedScore] = useState(false);
  const [reclaimMessage, setReclaimMessage] = useState<string | null>(null);
  const [reclaimUrl, setReclaimUrl] = useState<string | null>(null);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [completeSummary, setCompleteSummary] = useState<ScoreResponse | null>(null);
  const reclaimWindowRef = useRef<Window | null>(null);

  const openReclaimPortal = useCallback((url: string): boolean => {
    if (!url) return false;
    try {
      const existing = reclaimWindowRef.current;
      if (existing && !existing.closed) {
        existing.location.href = url;
        existing.focus();
        return true;
      }
      const win = window.open(url, "_blank");
      if (win) {
        reclaimWindowRef.current = win;
        win.focus();
        return true;
      }
    } catch {
      /* popup blocked */
    }
    return false;
  }, []);

  const loadProfile = useCallback(async () => {
    const data = await fetchProfile();
    setWallet(data.wallet);
    setProfile(data.profile);
    setHasOnChainSbt(data.hasOnChainSbt);
    setOnChainScore(data.onChainScore ?? null);
    setMintTxHash(data.mintTxHash ?? (data.profile?.mint_tx_hash as string | null) ?? null);

    const cached = hasCompleteScoreSnapshot(data.profile);
    setHasCachedScore(cached);

    if (cached || data.hasOnChainSbt) {
      const base =
        data.profile && cached ? profileToScoreData(data.profile) : { status: "complete" };
      setScoreData(
        applyOnChainScore(base, data.onChainScore, data.hasOnChainSbt)
      );
      setPhase("complete");
    } else {
      setScoreData(null);
      setPhase("empty");
    }
  }, []);

  useEffect(() => {
    loadProfile().catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load");
      setPhase("error");
    });
  }, [loadProfile]);

  const runScore = async (
    requireReclaim: boolean,
    reclaimSessionId?: string,
    preOpenedWindow?: Window | null
  ) => {
    setError(null);
    setPhase("scoring");
    setWalletTrack("running");
    setSybilTrack("running");
    if (requireReclaim && !reclaimSessionId) setReclaimTrack("idle");
    else if (requireReclaim) setReclaimTrack("done");

    try {
      const data = await requestScore({
        require_reclaim: requireReclaim,
        reclaim_session_id: reclaimSessionId,
      });

      if (data.status === "awaiting_reclaim") {
        setPhase("reclaim");
        setReclaimTrack("running");
        setWalletTrack("running");
        setSybilTrack("running");
        const url = data.reclaim_url as string;
        const sessionId = data.reclaim_session_id as string;
        if (!sessionId) {
          throw new Error("Scoring API returned awaiting_reclaim without reclaim_session_id");
        }
        setReclaimUrl(url || null);

        let portalOpened = false;
        if (url && preOpenedWindow && !preOpenedWindow.closed) {
          preOpenedWindow.location.href = url;
          preOpenedWindow.focus();
          reclaimWindowRef.current = preOpenedWindow;
          portalOpened = true;
        } else if (url) {
          portalOpened = openReclaimPortal(url);
        } else if (preOpenedWindow && !preOpenedWindow.closed) {
          preOpenedWindow.close();
        }

        setReclaimMessage(
          portalOpened
            ? "Complete bank login in the Reclaim tab. This page will detect verification automatically."
            : "Click Open Reclaim Portal below to log into your bank (popup was blocked)."
        );

        const finishScore = async (final: ScoreResponse) => {
          setWalletTrack("done");
          setSybilTrack("done");
          setReclaimTrack("done");
          setReclaimUrl(null);
          setScoreData(final);
          setCompleteSummary(final);
          setCompleteModalOpen(true);
          setPhase("complete");
          setReclaimMessage(null);
          if (reclaimWindowRef.current && !reclaimWindowRef.current.closed) {
            reclaimWindowRef.current.close();
          }
          await loadProfile();
        };

        const reclaimDeadline = Date.now() + 600_000;
        let bankVerified = false;

        while (Date.now() < reclaimDeadline && !bankVerified) {
          await new Promise((r) => setTimeout(r, 3000));

          const poll = await pollReclaimSession(sessionId);
          if (poll.ok && poll.status === "verified") {
            bankVerified = true;
            setReclaimTrack("done");
            setReclaimUrl(null);
            setPhase("scoring");
            setReclaimMessage(
              "Bank verified! Running CredScore analysis — this usually takes 1–2 minutes…"
            );
            break;
          }

          if (!poll.ok && poll.error === "session_not_found") {
            setReclaimMessage(
              "Waiting for bank verification… (keep ml:serve running)"
            );
          } else if (!poll.ok && poll.error === "invalid_response") {
            throw new Error(poll.detail || "Reclaim session poll failed");
          } else {
            setReclaimMessage("Waiting for bank verification in Reclaim…");
          }
        }

        if (!bankVerified) {
          throw new Error("Reclaim timed out — complete bank verification and try again");
        }

        setWalletTrack("running");
        setSybilTrack("running");
        const final = await requestScore({
          require_reclaim: true,
          reclaim_session_id: sessionId,
        });

        if (final.status !== "complete") {
          throw new Error(
            final.status === "awaiting_reclaim"
              ? "Bank proof not ready yet — try Rebuild score again"
              : "Scoring did not complete"
          );
        }

        await finishScore(final);
        return;
      }

      setWalletTrack("done");
      setSybilTrack("done");
      setScoreData(data);
      setCompleteSummary(data);
      setCompleteModalOpen(true);
      setPhase("complete");
      await loadProfile();
    } catch (e) {
      setWalletTrack("error");
      setSybilTrack("error");
      setReclaimTrack("error");
      setError(e instanceof Error ? e.message : "Scoring failed");
      setPhase("error");
    }
  };

  const startBankScore = () => {
    setModalOpen(false);
    setReclaimUrl(null);
    const preWin = window.open("about:blank", "_blank");
    if (preWin) {
      preWin.document.title = "Reclaim — loading…";
      preWin.document.body.innerHTML =
        "<p style='font-family:sans-serif;padding:2rem'>Loading Reclaim portal…</p>";
      reclaimWindowRef.current = preWin;
    }
    void runScore(true, undefined, preWin);
  };

  const handleResetCache = async () => {
    if (
      !window.confirm(
        "Delete Supabase score cache for this wallet? On-chain SBT will remain minted."
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Reset failed");
      setScoreData(null);
      await loadProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      setPhase("error");
    } finally {
      setResetting(false);
    }
  };

  const handleMint = async () => {
    setMinting(true);
    setMintError(null);
    try {
      const result = await mintSbt(scoreData || undefined);
      const tx =
        (result.tx as string | undefined) ||
        (result.mint_tx_hash as string | undefined) ||
        null;
      setMintTx(tx);
      await loadProfile();
    } catch (e) {
      setMintError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  if (phase === "loading") {
    return <p className="text-center text-sm text-zinc-500">Loading account…</p>;
  }

  if (phase === "empty") {
    return (
      <>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <p className="font-mono text-xs text-zinc-500">{wallet}</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-xl bg-emerald-600 px-8 py-4 text-base font-semibold text-white shadow-lg hover:bg-emerald-700"
          >
            Build Your Score
          </button>
        </div>
        <BuildScoreModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onWalletOnly={() => {
            setModalOpen(false);
            runScore(false);
          }}
          onWithBank={startBankScore}
        />
      </>
    );
  }

  if (phase === "scoring" || phase === "reclaim") {
    return (
      <>
        <ScoringProgress
          walletTrack={walletTrack}
          sybilTrack={sybilTrack}
          reclaimTrack={reclaimTrack !== "idle" ? reclaimTrack : undefined}
          reclaimUrl={phase === "reclaim" && reclaimTrack !== "done" ? reclaimUrl : null}
          onOpenReclaim={
            reclaimUrl && reclaimTrack !== "done"
              ? () => {
                  const opened = openReclaimPortal(reclaimUrl);
                  if (opened) {
                    setReclaimMessage(
                      "Complete bank login in the Reclaim tab. This page will detect verification automatically."
                    );
                  }
                }
              : undefined
          }
          message={
            reclaimMessage ||
            (phase === "reclaim"
              ? "Complete bank login in the Reclaim tab — analysis continues automatically"
              : "Analyzing your credit profile…")
          }
        />
      </>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => {
            setPhase("empty");
            setError(null);
          }}
          className="rounded-lg border px-4 py-2 text-sm"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <AccountDashboard
        wallet={wallet}
        data={scoreData || {}}
        profile={profile}
        hasOnChainSbt={hasOnChainSbt}
        onChainScore={onChainScore}
        hasCachedScore={hasCachedScore}
        onMint={handleMint}
        onRescore={() => setModalOpen(true)}
        onResetCache={handleResetCache}
        minting={minting}
        resetting={resetting}
        mintError={mintError}
        mintTx={mintTx}
        mintTxHash={mintTxHash}
      />
      <ScoreCompleteModal
        open={completeModalOpen}
        credScore={completeSummary?.cred_score as number | undefined}
        mlScore={completeSummary?.ml_cred_score as number | undefined}
        bankUsd={
          completeSummary?.balance_usd_cents != null
            ? (completeSummary.balance_usd_cents as number) / 100
            : undefined
        }
        sybilRisk={completeSummary?.sybil_risk as string | undefined}
        onClose={() => setCompleteModalOpen(false)}
      />
      <BuildScoreModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onWalletOnly={() => {
          setModalOpen(false);
          runScore(false);
        }}
        onWithBank={startBankScore}
      />
    </>
  );
}
