"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountDashboard } from "@/components/account/AccountDashboard";
import { BuildScoreModal } from "@/components/account/BuildScoreModal";
import { ScoringProgress } from "@/components/account/ScoringProgress";
import {
  fetchProfile,
  mintSbt,
  pollReclaimSession,
  requestScore,
  type ScoreResponse,
} from "@/lib/scoring-api";

type Phase = "loading" | "empty" | "scoring" | "reclaim" | "complete" | "error";

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
  const [error, setError] = useState<string | null>(null);
  const [walletTrack, setWalletTrack] = useState<"idle" | "running" | "done" | "error">("idle");
  const [sybilTrack, setSybilTrack] = useState<"idle" | "running" | "done" | "error">("idle");
  const [reclaimTrack, setReclaimTrack] = useState<"idle" | "running" | "done" | "error">("idle");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    const data = await fetchProfile();
    setWallet(data.wallet);
    setProfile(data.profile);
    setHasOnChainSbt(data.hasOnChainSbt);
    setOnChainScore(data.onChainScore ?? null);

    if (
      data.hasOnChainSbt ||
      data.profile?.cred_score ||
      (data.profile?.score_snapshot as ScoreResponse | undefined)?.status === "complete"
    ) {
      setScoreData(
        data.profile ? profileToScoreData(data.profile) : { status: "complete" }
      );
      setPhase("complete");
    } else {
      setPhase("empty");
    }
  }, []);

  useEffect(() => {
    loadProfile().catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load");
      setPhase("error");
    });
  }, [loadProfile]);

  const runScore = async (requireReclaim: boolean, reclaimSessionId?: string) => {
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
        if (url) window.open(url, "_blank", "noopener,noreferrer");

        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          const session = await pollReclaimSession(sessionId);
          if (session.status === "verified") {
            setReclaimTrack("done");
            const final = await requestScore({
              require_reclaim: true,
              reclaim_session_id: sessionId,
            });
            setWalletTrack("done");
            setSybilTrack("done");
            setScoreData(final);
            setPhase("complete");
            await loadProfile();
            return;
          }
        }
        throw new Error("Reclaim timed out — complete bank verification and try again");
      }

      setWalletTrack("done");
      setSybilTrack("done");
      setScoreData(data);
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

  const handleMint = async () => {
    setMinting(true);
    setMintError(null);
    try {
      const result = await mintSbt(scoreData || undefined);
      if (result.action === "skip") {
        setMintTx(null);
      } else {
        setMintTx((result.tx as string) || null);
      }
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
          onWithBank={() => {
            setModalOpen(false);
            runScore(true);
          }}
        />
      </>
    );
  }

  if (phase === "scoring" || phase === "reclaim") {
    return (
      <ScoringProgress
        walletTrack={walletTrack}
        sybilTrack={sybilTrack}
        reclaimTrack={phase === "reclaim" ? reclaimTrack : undefined}
        message={
          phase === "reclaim"
            ? "Complete bank login in the Reclaim tab — analysis continues automatically"
            : undefined
        }
      />
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
    <AccountDashboard
      wallet={wallet}
      data={scoreData || {}}
      profile={profile}
      hasOnChainSbt={hasOnChainSbt}
      onChainScore={onChainScore}
      onMint={handleMint}
      minting={minting}
      mintError={mintError}
      mintTx={mintTx}
    />
  );
}
