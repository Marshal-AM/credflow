"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountDashboard } from "@/components/account/AccountDashboard";
import { AccountScoreWorkspace } from "@/components/account/score-flow/AccountScoreWorkspace";
import { BuildScoreChooser } from "@/components/account/score-flow/BuildScoreChooser";
import { ScoreCompletePanel } from "@/components/account/score-flow/ScoreCompletePanel";
import { ReclaimWaitPanel } from "@/components/account/score-flow/ReclaimWaitPanel";
import { ScoringLiveView } from "@/components/account/score-flow/ScoringLiveView";
import {
  fetchProfile,
  pollReclaimSession,
  type ScoreResponse,
  type ScoreRunRecord,
} from "@/lib/scoring-api";
import { scoreDataFromLatestRun } from "@/lib/display-cred-score";
import { applyOnChainScore } from "@/lib/score-display";
import { useScoreFlowNavigationGuard } from "@/hooks/use-score-flow-navigation-guard";
import { toast } from "@/lib/toast";
import { useWalletApi } from "@/hooks/use-wallet-api";
import { ConnectWalletPrompt } from "@/components/wallet/ConnectWalletPrompt";

type Phase = "loading" | "empty" | "complete" | "error";
type ScoreFlowView = "dashboard" | "choose" | "calculating" | "reclaim" | "result";

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
  const [scoreFlowView, setScoreFlowView] = useState<ScoreFlowView>("dashboard");
  const [scoreData, setScoreData] = useState<ScoreResponse | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [hasOnChainSbt, setHasOnChainSbt] = useState(false);
  const [onChainScore, setOnChainScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [sbtTokenId, setSbtTokenId] = useState<string | null>(null);
  const [sbtLink, setSbtLink] = useState<string | null>(null);
  const [latestScoreRun, setLatestScoreRun] = useState<ScoreRunRecord | null>(null);
  const [hasCachedScore, setHasCachedScore] = useState(false);
  const [reclaimMessage, setReclaimMessage] = useState<string | null>(null);
  const [reclaimUrl, setReclaimUrl] = useState<string | null>(null);
  const [reclaimSessionId, setReclaimSessionId] = useState<string | null>(null);
  const [requireReclaimRun, setRequireReclaimRun] = useState(false);
  const [calculationKey, setCalculationKey] = useState(0);
  const [completeSummary, setCompleteSummary] = useState<ScoreResponse | null>(null);
  const reclaimWindowRef = useRef<Window | null>(null);
  const lastErrorToast = useRef<string | null>(null);
  const pollAbort = useRef(false);

  const scoringInProgress =
    phase !== "loading" &&
    phase !== "error" &&
    (phase === "empty" || scoreFlowView !== "dashboard") &&
    (scoreFlowView === "choose" ||
      scoreFlowView === "calculating" ||
      scoreFlowView === "reclaim");

  useScoreFlowNavigationGuard(scoringInProgress);

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
    setMintTxHash(data.mintTxHash ?? null);
    setSbtTokenId(data.sbtTokenId ?? null);
    setSbtLink(data.sbtLink ?? null);
    setLatestScoreRun(data.latestScoreRun);

    const fromRun = scoreDataFromLatestRun(data.latestScoreRun);
    const cached = hasCompleteScoreSnapshot(data.profile) || fromRun != null;
    setHasCachedScore(cached);

    if (fromRun) {
      setScoreData(fromRun);
      setPhase("complete");
    } else if (cached || data.hasOnChainSbt) {
      const base =
        data.profile && hasCompleteScoreSnapshot(data.profile)
          ? profileToScoreData(data.profile)
          : { status: "complete" };
      setScoreData(applyOnChainScore(base, data.onChainScore, data.hasOnChainSbt));
      setPhase("complete");
    } else {
      setScoreData(null);
      setPhase("empty");
      setScoreFlowView("choose");
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

  const cancelScoreFlow = () => {
    pollAbort.current = true;
    setScoreFlowView(phase === "empty" ? "choose" : "dashboard");
    setReclaimUrl(null);
    setReclaimSessionId(null);
    setReclaimMessage(null);
    setRequireReclaimRun(false);
  };

  const goToDashboard = () => {
    pollAbort.current = true;
    setError(null);
    lastErrorToast.current = null;
    setReclaimUrl(null);
    setReclaimSessionId(null);
    setReclaimMessage(null);
    setRequireReclaimRun(false);
    if (hasCachedScore || hasOnChainSbt) {
      setPhase("complete");
      setScoreFlowView("dashboard");
    } else {
      setPhase("empty");
      setScoreFlowView("choose");
    }
  };

  const retryAfterError = () => {
    setError(null);
    lastErrorToast.current = null;
    setPhase(hasCachedScore || hasOnChainSbt ? "complete" : "empty");
    setScoreFlowView("choose");
  };

  const beginCalculation = (requireReclaim: boolean, preOpenedWindow?: Window | null) => {
    if (!address) return;
    pollAbort.current = false;
    setError(null);
    lastErrorToast.current = null;
    setRequireReclaimRun(requireReclaim);
    setReclaimSessionId(null);
    setReclaimUrl(null);
    setReclaimMessage(null);
    setScoreFlowView("calculating");
    setCalculationKey((k) => k + 1);

    if (requireReclaim && preOpenedWindow) {
      reclaimWindowRef.current = preOpenedWindow;
    }
  };

  const startWalletScore = () => {
    beginCalculation(false);
  };

  const startBankScore = () => {
    const preWin = window.open("about:blank", "_blank");
    if (preWin) {
      preWin.document.title = "Reclaim — loading…";
      preWin.document.body.innerHTML =
        "<p style='font-family:sans-serif;padding:2rem'>Loading bank portal…</p>";
    }
    beginCalculation(true, preWin);
  };

  const handleStreamComplete = useCallback(
    async (data: Record<string, unknown>, extras?: Record<string, unknown>) => {
      const final = data as ScoreResponse;
      setScoreData(final);
      setCompleteSummary(final);
      setScoreFlowView("result");
      setPhase("complete");
      setReclaimUrl(null);
      setReclaimSessionId(null);
      if (reclaimWindowRef.current && !reclaimWindowRef.current.closed) {
        reclaimWindowRef.current.close();
      }

      const underwrite = extras?.underwrite as
        | { ok?: boolean; skipped?: boolean; data?: { onchain?: string } }
        | undefined;
      if (underwrite?.ok && underwrite.data?.onchain === "mintSBT") {
        toast.success("On-chain credential minted", "mint-success");
      } else if (underwrite?.ok && underwrite.data?.onchain === "updateScore") {
        toast.success("On-chain score updated", "score-updated");
      } else if (underwrite && !underwrite.ok && !underwrite.skipped) {
        toast.error("Could not update on-chain credential", "mint-error");
      }

      await loadProfile();
    },
    [loadProfile]
  );

  const handleAwaitingReclaim = useCallback(
    (data: Record<string, unknown>) => {
      const url = data.reclaim_url as string | undefined;
      const sessionId = data.reclaim_session_id as string | undefined;
      if (!sessionId) {
        setError("Bank verification could not be started.");
        setPhase("error");
        return;
      }

      setReclaimSessionId(sessionId);
      setReclaimUrl(url || null);
      setScoreFlowView("reclaim");

      let portalOpened = false;
      const preWin = reclaimWindowRef.current;
      if (url && preWin && !preWin.closed) {
        preWin.location.href = url;
        preWin.focus();
        portalOpened = true;
      } else if (url) {
        portalOpened = openReclaimPortal(url);
      }

      setReclaimMessage(
        portalOpened
          ? "Complete bank login in the Reclaim tab. This page will continue automatically."
          : "Click Open bank portal below to verify your account."
      );

      void (async () => {
        const reclaimDeadline = Date.now() + 600_000;
        while (Date.now() < reclaimDeadline && !pollAbort.current) {
          await new Promise((r) => setTimeout(r, 3000));
          const poll = await pollReclaimSession(sessionId);
          if (poll.ok && poll.status === "verified") {
            setReclaimUrl(null);
            setReclaimMessage("Bank verified. Calculating your score…");
            setScoreFlowView("calculating");
            setCalculationKey((k) => k + 1);
            return;
          }
          if (!poll.ok && poll.error === "invalid_response") {
            setError(poll.detail || "Bank verification failed");
            setPhase("error");
            return;
          }
          setReclaimMessage("Waiting for bank verification…");
        }
        if (!pollAbort.current) {
          setError("Bank verification timed out. Please try again.");
          setPhase("error");
        }
      })();
    },
    [openReclaimPortal]
  );

  const handleStreamError = useCallback((message: string) => {
    setError(message);
    setPhase("error");
  }, []);

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

  if (phase === "error") {
    return (
      <AccountScoreWorkspace>
        <div className="mx-auto max-w-md space-y-5 py-12 text-center">
          <div>
            <p className="section-label">Something went wrong</p>
            <p className="mt-2 text-sm text-muted-foreground">{error ?? "Something went wrong."}</p>
          </div>
          <div className="flex flex-col justify-center gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={retryAfterError} className="btn-secondary">
              Try again
            </button>
            <button type="button" onClick={goToDashboard} className="btn-outline-primary">
              Back to dashboard
            </button>
          </div>
        </div>
      </AccountScoreWorkspace>
    );
  }

  const showWorkspace =
    phase === "empty" ||
    (phase === "complete" && scoreFlowView !== "dashboard");

  if (showWorkspace) {
    return (
      <AccountScoreWorkspace>
        {scoreFlowView === "choose" && (
          <BuildScoreChooser
            onWalletOnly={startWalletScore}
            onWithBank={startBankScore}
            showCancel={phase === "complete"}
            onCancel={phase === "complete" ? cancelScoreFlow : undefined}
            cancelLabel="Back to dashboard"
          />
        )}

        {scoreFlowView === "reclaim" && (
          <ReclaimWaitPanel
            message={reclaimMessage ?? undefined}
            reclaimUrl={reclaimUrl}
            onOpenReclaim={
              reclaimUrl
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
            onCancel={cancelScoreFlow}
            cancelLabel="Back to dashboard"
          />
        )}

        {scoreFlowView === "calculating" && address && (
          <ScoringLiveView
            key={calculationKey}
            wallet={address}
            requireReclaim={requireReclaimRun}
            reclaimSessionId={reclaimSessionId ?? undefined}
            onComplete={(data) => void handleStreamComplete(data)}
            onAwaitingReclaim={handleAwaitingReclaim}
            onError={handleStreamError}
            onBack={phase === "complete" ? cancelScoreFlow : undefined}
          />
        )}

        {scoreFlowView === "result" && (
          <ScoreCompletePanel
            credScore={completeSummary?.cred_score as number | undefined}
            sybilRisk={completeSummary?.sybil_risk as string | undefined}
            bankUsd={
              completeSummary?.balance_usd_cents != null
                ? (completeSummary.balance_usd_cents as number) / 100
                : undefined
            }
            onContinue={() => setScoreFlowView("dashboard")}
          />
        )}
      </AccountScoreWorkspace>
    );
  }

  return (
    <AccountDashboard
      data={scoreData || {}}
      profile={profile}
      latestScoreRun={latestScoreRun}
      hasOnChainSbt={hasOnChainSbt}
      onChainScore={onChainScore}
      hasCachedScore={hasCachedScore}
      mintTxHash={mintTxHash}
      sbtTokenId={sbtTokenId}
      sbtLink={sbtLink}
      onRescore={() => setScoreFlowView("choose")}
      onAddBank={startBankScore}
    />
  );
}
