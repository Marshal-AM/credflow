"use client";

type Props = {
  open: boolean;
  title?: string;
  message?: string;
  stayLabel?: string;
  leaveLabel?: string;
  onStay: () => void;
  onLeave: () => void;
};

export function ConfirmLeaveDialog({
  open,
  title = "Leave scoring?",
  message = "All scoring progress will be lost. Are you sure you want to leave?",
  stayLabel = "Stay",
  leaveLabel = "Leave",
  onStay,
  onLeave,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-leave-title"
      aria-describedby="confirm-leave-desc"
    >
      <div className="modal-panel max-w-md">
        <h3 id="confirm-leave-title" className="text-lg font-[650]">
          {title}
        </h3>
        <p id="confirm-leave-desc" className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onLeave} className="btn-secondary">
            {leaveLabel}
          </button>
          <button type="button" onClick={onStay} className="btn-primary">
            {stayLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
