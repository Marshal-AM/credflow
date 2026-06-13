"use client";

import { useEffect, type ReactNode } from "react";
import type { ScoreResponse } from "@/lib/scoring-api";
import { applyOnChainScore } from "@/lib/score-display";
import { toast } from "@/lib/toast";
import { scoreTier, sybilLabel, sybilVisual } from "@/lib/score-tier";
import { CredScoreGauge } from "@/components/account/CredScoreGauge";

type Props = {
  data: ScoreResponse;
  profile?: Record<string, unknown> | null;
  hasOnChainSbt: boolean;
  onChainScore?: number | null;
  hasCachedScore: boolean;
  onMint: () => void;
  onRescore: () => void;
  minting: boolean;
  mintError?: string | null;
};

function strengthLabel(value?: number): string {
  if (value == null || Number.isNaN(value)) return "Not scored";
  if (value >= 750) return "Strong";
  if (value >= 650) return "Solid";
  if (value >= 550) return "Fair";
  return "Building";
}

type ValueTone = "positive" | "negative" | "neutral";

function toneClass(tone: ValueTone): string {
  if (tone === "positive") return "text-success";
  if (tone === "negative") return "text-destructive";
  return "";
}

function strengthTone(label: string): ValueTone {
  if (label === "Strong" || label === "Solid") return "positive";
  if (label === "Building" || label === "Not scored") return "negative";
  return "neutral";
}

function tierTone(label: string): ValueTone {
  if (label === "Excellent" || label === "Good") return "positive";
  if (label === "Poor") return "negative";
  return "neutral";
}

function riskTone(risk?: string): ValueTone {
  if (risk === "low") return "positive";
  if (risk === "high") return "negative";
  return "neutral";
}

function fraudScreenTone(state: "verified" | "pending" | "review" | "flagged"): ValueTone {
  if (state === "verified") return "positive";
  if (state === "flagged") return "negative";
  return "neutral";
}

function maxLtvForScore(score: number): string {
  if (score >= 750) return "Up to 75%";
  if (score >= 670) return "Up to 65%";
  if (score >= 580) return "Up to 55%";
  return "Up to 45%";
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

function Subsection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-xl border border-border/50 bg-card/40 p-4 ${className}`}
    >
      <h3 className="section-label mb-2 shrink-0">{title}</h3>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: ValueTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-[650] text-right ${toneClass(tone)}`}>{value}</span>
    </div>
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
      className={`flex min-w-0 flex-1 items-center gap-4 rounded-lg border px-4 py-3.5 ${
        verified
          ? "border-primary/35 bg-primary/10"
          : "border-border/50 bg-muted/15"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
          verified ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className={`truncate font-[650] ${verified ? "text-foreground" : "text-muted-foreground"}`}>
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

function ShieldIcon({ state }: { state: "verified" | "pending" | "review" | "flagged" }) {
  const colors = {
    verified: "text-primary border-primary/30 bg-primary/10",
    pending: "text-muted-foreground border-border/60 bg-muted/30",
    review: "text-primary border-primary/30 bg-primary/10",
    flagged: "text-primary border-primary/30 bg-primary/10",
  };
  return (
    <div className={`mb-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${colors[state]}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
        {state === "verified" && <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />}
        {state === "pending" && <path d="M12 8v4M12 16h.01" strokeLinecap="round" />}
        {state === "review" && <path d="M12 8v4M12 16h.01" strokeLinecap="round" />}
        {state === "flagged" && <path d="m15 9-6 6M9 9l6 6" strokeLinecap="round" />}
      </svg>
    </div>
  );
}

function EligibilityRing({ eligible }: { eligible: boolean }) {
  return (
    <div className="relative mb-2 flex h-12 w-12 shrink-0 items-center justify-center">
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-muted)" strokeWidth="3" />
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke={eligible ? "var(--color-primary)" : "var(--color-subtle)"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={125.6}
          strokeDashoffset={eligible ? 0 : 94}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {eligible ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

function CredentialBadge({ active }: { active: boolean }) {
  return (
    <div
      className={`mb-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-dashed border-border/70 bg-muted/20 text-muted-foreground"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M12 2l2.4 4.8 5.4.8-3.9 3.8.9 5.3L12 14.3 7.2 16.7l.9-5.3L4.2 7.6l5.4-.8L12 2z" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ProfileIcon() {
  return (
    <div className="mb-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M3 3v18h18" strokeLinecap="round" />
        <path d="M7 16l4-5 4 3 5-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function AccountDashboard({
  data,
  profile,
  hasOnChainSbt,
  onChainScore,
  hasCachedScore,
  onMint,
  onRescore,
  minting,
  mintError,
}: Props) {
  const display = applyOnChainScore(data, onChainScore, hasOnChainSbt);
  const credScore =
    onChainScore ??
    (display.cred_score as number) ??
    (profile?.cred_score as number);
  const score = typeof credScore === "number" ? credScore : null;
  const tier = score != null ? scoreTier(score) : null;
  const sybilRisk = data.sybil_risk as string | undefined;
  const sybilDetails = (data.sybil_details ?? profile?.sybil_details) as Record<string, unknown> | undefined;
  const identity = sybilVisual(sybilRisk);
  const bankVerified = ((data.balance_usd_cents as number) ?? 0) > 0;
  const walletVerified = hasCachedScore || hasOnChainSbt;
  const minted = hasOnChainSbt || profile?.mint_status === "minted";
  const approved = data.approved !== false && (profile?.approved as boolean) !== false;
  const walletSub = (display.wallet_sub_score ?? profile?.wallet_sub_score) as number | undefined;
  const borrowSub = (display.borrow_sub_score ?? profile?.borrow_sub_score) as number | undefined;
  const verifiedCount = [walletVerified, bankVerified].filter(Boolean).length;
  const counterparties = sybilDetails?.unique_counterparties as number | undefined;

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
        data.rejection_reason || profile?.rejection_reason || "Score did not meet lending requirements"
      );
      toast.error(`Not eligible to borrow: ${reason}`, "not-approved");
    }
  }, [approved, hasCachedScore, data.rejection_reason, profile?.rejection_reason]);

  useEffect(() => {
    if (mintError) {
      toast.error(mintError, "mint-error");
    }
  }, [mintError]);

  return (
    <div className="min-h-full">
      <div className="grid min-h-full items-stretch gap-3 xl:grid-cols-[1.15fr_1fr]">
        <div className="card-padded flex h-full min-h-0 flex-col items-center py-3">
          {score != null ? (
            <>
              <div className="flex w-full flex-1 min-h-0 flex-col items-center justify-center">
                <CredScoreGauge score={score} />
              </div>
              <button
                type="button"
                onClick={onRescore}
                className="btn-outline-primary mt-2 shrink-0"
              >
                Recalculate Score
              </button>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="section-label">CredScore</p>
              <p className="mt-4 text-muted-foreground">Score not available yet</p>
              <button type="button" onClick={onRescore} className="btn-outline-primary mt-4">
                Recalculate Score
              </button>
            </div>
          )}
        </div>

        <div className="flex h-full min-h-0 flex-col gap-2">
          <Subsection title="Verification sources" className="!h-auto shrink-0">
            <p className="mb-2 text-xs text-muted-foreground">
              {verifiedCount} of 2 sources connected
            </p>
            <div className="grid grid-cols-2 gap-2">
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
                    ? `$${((data.balance_usd_cents as number) / 100).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} verified balance`
                    : "Not connected"
                }
                verified={bankVerified}
              />
            </div>
          </Subsection>

          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
            <Subsection title="Identity">
              <ShieldIcon state={identity} />
              <p className="text-base font-[650] text-primary">{sybilLabel(sybilRisk)}</p>
              <div className="mt-2 space-y-2">
                <DetailRow
                  label="Fraud screening"
                  tone={fraudScreenTone(identity)}
                  value={
                    identity === "verified"
                      ? "Passed"
                      : identity === "pending"
                        ? "In progress"
                        : identity === "review"
                          ? "Under review"
                          : "Failed"
                  }
                />
                {counterparties != null && (
                  <DetailRow label="Wallet connections" value={String(counterparties)} />
                )}
                <DetailRow
                  label="Risk level"
                  tone={riskTone(sybilRisk)}
                  value={sybilRisk ? sybilRisk.charAt(0).toUpperCase() + sybilRisk.slice(1) : "Pending"}
                />
              </div>
            </Subsection>

            <Subsection title="Borrowing">
              <EligibilityRing eligible={approved} />
              <p className="text-base font-[650] text-primary">
                {approved ? "Ready for loans" : "Locked"}
              </p>
              <div className="mt-2 space-y-2">
                <DetailRow
                  label="Status"
                  tone={approved ? "positive" : "negative"}
                  value={approved ? "Eligible" : "Not eligible"}
                />
                {score != null && <DetailRow label="Max LTV" value={maxLtvForScore(score)} />}
                {tier && (
                  <DetailRow label="Rate tier" tone={tierTone(tier.label)} value={tier.label} />
                )}
              </div>
            </Subsection>

            <Subsection title="On-chain credential">
              <CredentialBadge active={!!minted} />
              <p className="text-base font-[650] text-primary">
                {minted ? "Active" : !hasCachedScore ? "Not started" : approved ? "Ready to mint" : "Unavailable"}
              </p>
              <div className="mt-2 space-y-2">
                <DetailRow label="Network" value="Robinhood hub" />
                <DetailRow label="Type" value="Soulbound token" />
                <DetailRow
                  label="Cross-chain"
                  tone={minted ? "positive" : "neutral"}
                  value={minted ? "Synced to spokes" : "After minting"}
                />
              </div>
              {!minted && hasCachedScore && approved && (
                <button
                  type="button"
                  disabled={minting}
                  onClick={onMint}
                  className="btn-primary mt-3 w-full disabled:opacity-50"
                >
                  {minting ? "Minting…" : "Mint credential"}
                </button>
              )}
            </Subsection>

            <Subsection title="Profile strength">
              <ProfileIcon />
              <p className="text-base font-[650] text-primary">
                {score != null ? `${tier?.label} profile` : "Incomplete"}
              </p>
              <div className="mt-2 space-y-2">
                <DetailRow
                  label="Wallet activity"
                  tone={strengthTone(strengthLabel(walletSub))}
                  value={strengthLabel(walletSub)}
                />
                <DetailRow
                  label="Borrow history"
                  tone={strengthTone(strengthLabel(borrowSub))}
                  value={strengthLabel(borrowSub)}
                />
                <DetailRow
                  label="Bank boost"
                  tone={bankVerified ? "positive" : "negative"}
                  value={bankVerified ? "Applied" : "Not added"}
                />
              </div>
            </Subsection>
          </div>
        </div>
      </div>
    </div>
  );
}
