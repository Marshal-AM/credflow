"use client";

type Props = {
  message?: string;
  reclaimUrl?: string | null;
  onOpenReclaim?: () => void;
  onCancel: () => void;
  cancelLabel?: string;
};

export function ReclaimWaitPanel({
  message,
  reclaimUrl,
  onOpenReclaim,
  onCancel,
  cancelLabel = "Back to dashboard",
}: Props) {
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center px-4 py-8 text-center">
      <p className="section-label">Bank verification</p>
      <h3 className="mt-2 text-xl font-[650] tracking-tight">Verify your bank account</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {message ?? "Complete bank login in the Reclaim portal. This page continues automatically."}
      </p>

      {reclaimUrl && onOpenReclaim && (
        <div className="mt-6 w-full max-w-sm rounded-xl border border-primary/30 bg-primary/10 p-4">
          <button type="button" onClick={onOpenReclaim} className="btn-primary w-full">
            Open bank portal
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Popup blocked? Use this button — it opens on your click.
          </p>
        </div>
      )}

      <div className="mt-8 flex h-8 w-8 animate-pulse items-center justify-center rounded-full bg-primary/20">
        <span className="h-2 w-2 rounded-full bg-primary" />
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="mt-8 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {cancelLabel}
      </button>
    </div>
  );
}
