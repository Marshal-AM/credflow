"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { ScoreResponse, ScoreRunRecord } from "@/lib/scoring-api";
import { resolveDisplayCredScore } from "@/lib/display-cred-score";
import { buildScoreRunDetailCards } from "@/lib/score-run-display";
import { toast } from "@/lib/toast";
import { CredScoreGauge } from "@/components/account/CredScoreGauge";

type Props = {
  data: ScoreResponse;
  profile?: Record<string, unknown> | null;
  latestScoreRun?: ScoreRunRecord | null;
  hasOnChainSbt: boolean;
  onChainScore?: number | null;
  hasCachedScore: boolean;
  mintTxHash?: string | null;
  sbtTokenId?: string | null;
  sbtLink?: string | null;
  onRescore: () => void;
  onAddBank?: () => void;
};

type ValueTone = "positive" | "negative" | "neutral";

function toneClass(tone: ValueTone): string {
  if (tone === "positive") return "text-success";
  if (tone === "negative") return "text-destructive";
  return "";
}

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function BankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M5 21V10M9 21V10M13 21V10M17 21V10" />
      <path d="m2 10 10-7 10 7" />
    </svg>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border/50 bg-card/40 p-3 ${className}`}
    >
      <div className="mb-2">
        <h3 className="section-label">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SourceCard({
  icon: Icon,
  label,
  detail,
  verified,
}: {
  icon: typeof WalletIcon;
  label: string;
  detail: string;
  verified: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 ${
        verified
          ? "border-primary/35 bg-primary/10"
          : "border-border/50 bg-muted/15"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
          verified ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className={`truncate text-sm font-[650] ${verified ? "text-foreground" : "text-muted-foreground"}`}>
          {label}
        </p>
        <p
          className={`mt-0.5 truncate text-xs ${
            verified ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  lines,
}: {
  title: string;
  lines: Array<{ label: string; value: string; tone?: ValueTone; href?: string }>;
}) {
  return (
    <article className="rounded-lg border border-border/45 bg-card/50 p-3">
      <p className="section-label mb-2">{title}</p>
      <div className="space-y-1.5">
        {lines.map((line) => (
          <div key={line.label} className="flex items-start justify-between gap-3 text-[0.8125rem] leading-snug">
            <span className="shrink-0 text-muted-foreground">{line.label}</span>
            {line.href ? (
              <a
                href={line.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`min-w-0 text-right font-[650] underline decoration-border/60 underline-offset-2 transition-colors hover:decoration-foreground ${toneClass(line.tone ?? "neutral")}`}
                title={line.value}
              >
                {line.value.length > 28 ? `${line.value.slice(0, 14)}…${line.value.slice(-8)}` : line.value}
              </a>
            ) : (
              <span
                className={`min-w-0 text-right text-sm font-[650] break-words ${toneClass(line.tone ?? "neutral")}`}
                title={line.value}
              >
                {line.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

export function AccountDashboard({
  data,
  profile,
  latestScoreRun,
  hasOnChainSbt,
  onChainScore,
  hasCachedScore,
  mintTxHash,
  sbtTokenId,
  sbtLink,
  onRescore,
  onAddBank,
}: Props) {
  const scoreResponse = (latestScoreRun?.response as ScoreResponse | undefined) ?? data;
  const score = resolveDisplayCredScore({
    latestScoreRun,
    scoreData: data,
    profile,
  });
  const balanceCents =
    (scoreResponse.balance_usd_cents as number | undefined) ??
    (data.balance_usd_cents as number | undefined) ??
    (profile?.balance_usd_cents as number | undefined);
  const bankVerified = (balanceCents ?? 0) > 0;
  const walletVerified = hasCachedScore || hasOnChainSbt;
  const minted = hasOnChainSbt || profile?.mint_status === "minted";
  const approved = scoreResponse.approved !== false;

  const detailCards = useMemo(
    () =>
      buildScoreRunDetailCards(scoreResponse, {
        minted,
        mintTxHash,
        sbtTokenId,
        sbtLink,
      }),
    [scoreResponse, minted, mintTxHash, sbtTokenId, sbtLink]
  );

  const showAddBankAction = !bankVerified && hasCachedScore && !!onAddBank;
  const showActionsSection = showAddBankAction;

  useEffect(() => {
    if (hasOnChainSbt && !hasCachedScore) {
      toast.warning(
        "Your on-chain credential exists. Recalculate your score to refresh your full profile.",
        "sbt-no-cache"
      );
    }
  }, [hasOnChainSbt, hasCachedScore]);

  useEffect(() => {
    if (!approved && hasCachedScore) {
      const reason = String(
        scoreResponse.rejection_reason ||
          data.rejection_reason ||
          profile?.rejection_reason ||
          "Score did not meet lending requirements"
      );
      toast.error(`Not eligible to borrow: ${reason}`, "not-approved");
    }
  }, [approved, hasCachedScore, scoreResponse.rejection_reason, data.rejection_reason, profile?.rejection_reason]);

  return (
    <div className="account-dashboard">
      {/*
        Fixed-height workspace: fits below page title within the viewport.
        Both columns share this height; only the right metrics pane scrolls.
      */}
      <div className="grid gap-3 xl:grid-cols-[1.05fr_1fr] xl:h-[calc(100svh-14.5rem)] xl:min-h-[26rem] xl:max-h-[44rem]">
        {/* Left — gauge column, vertically centered in fixed panel */}
        <div className="card-padded flex min-h-[18rem] flex-col items-center justify-center py-4 xl:min-h-0 xl:h-full">
          {score != null ? (
            <>
              <div className="flex w-full max-w-sm flex-1 items-center justify-center xl:min-h-0">
                <CredScoreGauge score={score} />
              </div>
              <button
                type="button"
                onClick={onRescore}
                className="btn-primary mt-3 shrink-0 px-8 py-2.5 text-[0.9375rem]"
              >
                Recalculate Score
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="section-label">CredScore</p>
              <p className="mt-3 text-sm text-muted-foreground">Score not available yet</p>
              <button
                type="button"
                onClick={onRescore}
                className="btn-primary mt-4 px-8 py-2.5 text-[0.9375rem]"
              >
                Recalculate Score
              </button>
            </div>
          )}
        </div>

        {/* Right — pinned header + scroll body + pinned footer */}
        <div className="flex min-h-[22rem] min-w-0 flex-col gap-2 xl:min-h-0 xl:h-full">
          <Panel title="Verification sources" className="shrink-0">
            <div className="grid min-w-0 grid-cols-2 gap-1.5">
              <SourceCard
                icon={WalletIcon}
                label="Wallet history"
                detail={walletVerified ? "On-chain activity verified" : "Not connected"}
                verified={walletVerified}
              />
              <SourceCard
                icon={BankIcon}
                label="Bank account"
                detail={
                  bankVerified
                    ? `$${((balanceCents ?? 0) / 100).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} verified balance`
                    : "Not connected"
                }
                verified={bankVerified}
              />
            </div>
          </Panel>

          <section className="flex max-h-[26rem] min-h-[10rem] flex-1 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/25 sm:max-h-[28rem] xl:max-h-none xl:min-h-0">
            <header className="shrink-0 border-b border-border/40 px-3 py-2.5">
              <p className="section-label">Profile details</p>
            </header>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2.5"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {detailCards.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {detailCards.map((card) => (
                    <MetricCard key={card.id} title={card.title} lines={card.lines} />
                  ))}
                </div>
              ) : (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No score run data yet. Recalculate your score to populate this panel.
                </p>
              )}
            </div>
          </section>

          {showActionsSection ? (
            <Panel title="Next steps" className="shrink-0">
              <p className="mb-2 text-[0.8125rem] text-muted-foreground">
                Complete these actions to unlock the full CredFlow experience.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {showAddBankAction ? (
                  <button
                    type="button"
                    onClick={onAddBank}
                    className="btn-secondary flex-1 sm:min-w-[12rem]"
                  >
                    Connect bank account
                  </button>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
