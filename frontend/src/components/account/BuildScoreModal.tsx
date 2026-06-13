type Props = {
  open: boolean;
  onClose: () => void;
  onWalletOnly: () => void;
  onWithBank: () => void;
};

export function BuildScoreModal({ open, onClose, onWalletOnly, onWithBank }: Props) {
  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-md">
        <h3 className="text-lg font-[650]">Build your CredScore</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose how much data to include. Adding your bank account typically improves your score
          and borrowing limit.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onWalletOnly}
            className="surface-row px-4 py-4 text-left text-sm transition-spring hover:scale-[1.02] hover:border-primary/40"
          >
            <span className="font-[650]">Wallet only</span>
            <span className="mt-1 block text-muted-foreground">
              Uses your on-chain activity and transaction history
            </span>
          </button>
          <button
            type="button"
            onClick={onWithBank}
            className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-4 text-left text-sm transition-spring hover:scale-[1.02] hover:border-primary/50"
          >
            <span className="font-[650]">Wallet + bank account</span>
            <span className="mt-1 block text-muted-foreground">
              Verify your bank balance for a stronger score
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
