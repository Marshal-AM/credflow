"use client";

type Props = {
  open: boolean;
  credScore?: number;
  mlScore?: number;
  bankUsd?: number;
  sybilRisk?: string;
  onClose: () => void;
};

export function ScoreCompleteModal({
  open,
  credScore,
  mlScore,
  bankUsd,
  sybilRisk,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-950">
            ✓
          </div>
          <h3 className="mt-4 text-xl font-semibold">CredScore ready</h3>
          <p className="mt-2 text-sm text-zinc-500">
            Bank verification and ML analysis finished. Your results are saved to Supabase.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">CredScore</p>
            <p className="text-2xl font-bold">{credScore ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">ML score</p>
            <p className="text-2xl font-bold">{mlScore ?? credScore ?? "—"}</p>
          </div>
          {bankUsd != null && bankUsd > 0 && (
            <div className="col-span-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500">Verified bank capacity</p>
              <p className="text-lg font-semibold">${bankUsd.toFixed(2)}</p>
            </div>
          )}
          {sybilRisk && (
            <div className="col-span-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500">Sybil risk</p>
              <p className="font-medium capitalize">{sybilRisk}</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          View dashboard
        </button>
      </div>
    </div>
  );
}
