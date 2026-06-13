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
import { toast } from "@/lib/toast";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";

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
  const { address, isConnected, isConnecting } = useWalletApi();
  const [phase, setPhase] = useState<Phase>("loading");
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
  const [hasCachedScore, setHasCachedScore] = useState(false);
  const [reclaimMessage, setReclaimMessage] = useState<string | null>(null);
  const [reclaimUrl, setReclaimUrl] = useState<string | null>(null);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [completeSummary, setCompleteSummary] = useState<ScoreResponse | null>(null);
  const reclaimWindowRef = useRef<Window | null>(null);
  const lastErrorToast = useRef<string | null>(null);

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
    if (!address) return;
    const data = await fetchProfile(address);
    setProfile(data.profile);
    setHasOnChainSbt(data.hasOnChainSbt);
    setOnChainScore(data.onChainScore ?? null);

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
  }, [address]);

  useEffect(() => {
    if (!address) {
      setPhase("empty");
      return;
    }
    loadProfile().catch((e) => {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
      setPhase("error");
    });
  }, [loadProfile, address]);

  useEffect(() => {
    if (phase === "error" && error && error !== lastErrorToast.current) {
      toast.error(error, "account-error");
      lastErrorToast.current = error;
    }
  }, [phase, error]);

  const runScore = async (
    requireReclaim: boolean,
    reclaimSessionId?: string,
    preOpenedWindow?: Window | null
  ) => {
    if (!address) throw new Error("Connect your wallet to continue");
    setError(null);
    lastErrorToast.current = null;
    setPhase("scoring");
    setWalletTrack("running");
    setSybilTrack("running");
    if (requireReclaim && !reclaimSessionId) setReclaimTrack("idle");
    else if (requireReclaim) setReclaimTrack("done");

    try {
      const data = await requestScore(address, {
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
          throw new Error("Bank verification could not be started. Please try again.");
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
            ? "Complete bank login in the Reclaim tab. This page will continue automatically."
            : "Click Open bank portal below to verify your account."
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
            setReclaimMessage("Bank verified. Calculating your score…");
            break;
          }

          if (!poll.ok && poll.error === "session_not_found") {
            setReclaimMessage("Waiting for bank verification…");
          } else if (!poll.ok && poll.error === "invalid_response") {
            throw new Error(poll.detail || "Bank verification failed");
          } else {
            setReclaimMessage("Waiting for bank verification…");
          }
        }

        if (!bankVerified) {
          throw new Error("Bank verification timed out. Please try again.");
        }

        setWalletTrack("running");
        setSybilTrack("running");
        const final = await requestScore(address, {
          require_reclaim: true,
          reclaim_session_id: sessionId,
        });

        if (final.status !== "complete") {
          throw new Error(
            final.status === "awaiting_reclaim"
              ? "Bank proof not ready yet — try updating your score again"
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
        "<p style='font-family:sans-serif;padding:2rem'>Loading bank portal…</p>";
      reclaimWindowRef.current = preWin;
    }
    void runScore(true, undefined, preWin);
  };

  const handleMint = async () => {
    setMinting(true);
    setMintError(null);
    try {
      await mintSbt(address!, scoreData || undefined);
      toast.success("Credential minted successfully", "mint-success");
      await loadProfile();
    } catch (e) {
      setMintError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  if (!isConnected && !isConnecting) {
    return <ConnectWalletPrompt message="Connect your wallet to build and view your CredScore" />;
  }

  if (phase === "loading") {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-8 w-48 animate-shimmer rounded-xl" />
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-6 card-padded border border-border/80 text-center">
          <div>
            <h3 className="text-xl font-[650]">Get your CredScore</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Connect your wallet history and optionally verify your bank account to see how much you
              can borrow.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn-primary px-10 py-4 text-base"
          >
            Build your score
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
                    "Complete bank login in the Reclaim tab. This page will continue automatically."
                  );
                }
              }
            : undefined
        }
        message={
          reclaimMessage ||
          (phase === "reclaim"
            ? "Verify your bank account to continue"
            : "Calculating your CredScore…")
        }
      />
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center card-padded">
        <p className="text-sm text-muted-foreground">Something went wrong. You can try again.</p>
        <button
          type="button"
          onClick={() => {
            setPhase(hasCachedScore || hasOnChainSbt ? "complete" : "empty");
            setError(null);
            lastErrorToast.current = null;
          }}
          className="btn-secondary"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <AccountDashboard
        data={scoreData || {}}
        profile={profile}
        hasOnChainSbt={hasOnChainSbt}
        onChainScore={onChainScore}
        hasCachedScore={hasCachedScore}
        onMint={handleMint}
        onRescore={() => setModalOpen(true)}
        minting={minting}
        mintError={mintError}
      />
      <ScoreCompleteModal
        open={completeModalOpen}
        credScore={completeSummary?.cred_score as number | undefined}
        bankUsd={
          completeSummary?.balance_usd_cents != null
            ? (completeSummary.balance_usd_cents as number) / 100
            : undefined
        }
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
    </div>
  );
}
