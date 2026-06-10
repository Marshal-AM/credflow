type Track = "idle" | "running" | "done" | "error";

type Props = {
  walletTrack: Track;
  sybilTrack: Track;
  reclaimTrack?: Track;
  message?: string;
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
}: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <p className="text-center text-sm text-zinc-500">
        {message || "Analyzing your credit profile…"}
      </p>
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
          detail="Waiting for bank proof via Reclaim portal"
          status={reclaimTrack}
        />
      )}
    </div>
  );
}
