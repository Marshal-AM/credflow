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
      ? "bg-emerald-500"
      : status === "running"
        ? "bg-amber-400 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-zinc-300";
  return (
    <div className="flex gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-zinc-500">{detail}</p>
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
      <p className="text-center text-sm text-zinc-500">
        {message || "Analyzing your credit profile…"}
      </p>

      {reclaimUrl && onOpenReclaim && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-sm text-emerald-900 dark:text-emerald-100">
            Log into your bank in the Reclaim portal to continue.
          </p>
          <button
            type="button"
            onClick={onOpenReclaim}
            className="mt-3 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Open Reclaim Portal
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            Popup blocked? Use this button — it opens on your click.
          </p>
        </div>
      )}

      <TrackRow
        label="Wallet analysis"
        detail="XGBoost on DeFi history, borrow behavior, wallet age"
        status={walletTrack}
      />
      <TrackRow
        label="R-GCN Sybil detector"
        detail="Transaction graph, defaulter links, farming patterns"
        status={sybilTrack}
      />
      {reclaimTrack && reclaimTrack !== "idle" && (
        <TrackRow
          label="Bank verification (Reclaim)"
          detail={
            reclaimTrack === "done"
              ? "Bank proof verified"
              : "Waiting for bank proof via Reclaim portal"
          }
          status={reclaimTrack}
        />
      )}
    </div>
  );
}
