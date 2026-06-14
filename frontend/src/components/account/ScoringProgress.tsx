type Track = "idle" | "running" | "done" | "error";

type Props = {
  walletTrack: Track;
  sybilTrack: Track;
  reclaimTrack?: Track;
  message?: string;
  reclaimUrl?: string | null;
  onOpenReclaim?: () => void;
};

function TrackRow({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: Track;
}) {
  const dot =
    status === "done"
      ? "bg-emerald-400"
      : status === "running"
        ? "bg-primary animate-pulse"
        : status === "error"
          ? "bg-red-400"
          : "bg-muted-foreground/30";
  return (
    <div className="flex gap-3 surface-row p-4 transition-spring hover:scale-[1.01]">
      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div>
        <p className="text-sm font-[650]">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function ScoringProgress({
  walletTrack,
  sybilTrack,
  reclaimTrack,
  message,
  reclaimUrl,
  onOpenReclaim,
}: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        {message || "Calculating your CredScore…"}
      </p>

      {reclaimUrl && onOpenReclaim && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-center">
          <p className="text-sm text-primary">Log into your bank to continue.</p>
          <button type="button" onClick={onOpenReclaim} className="btn-primary mt-3">
            Open bank portal
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Popup blocked? Use this button — it opens on your click.
          </p>
        </div>
      )}

      <TrackRow
        label="Wallet history"
        detail="Reviewing your on-chain activity"
        status={walletTrack}
      />
      <TrackRow
        label="Identity check"
        detail="Screening for fraud and sybil patterns"
        status={sybilTrack}
      />
      {reclaimTrack && reclaimTrack !== "idle" && (
        <TrackRow
          label="Bank verification"
          detail={
            reclaimTrack === "done"
              ? "Bank account verified"
              : "Waiting for bank login"
          }
          status={reclaimTrack}
        />
      )}
    </div>
  );
}
