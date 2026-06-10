type Props = {
  open: boolean;
  onClose: () => void;
  onWalletOnly: () => void;
  onWithBank: () => void;
};

export function BuildScoreModal({ open, onClose, onWalletOnly, onWithBank }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <h3 className="text-lg font-semibold">Build your CredScore</h3>
        <p className="mt-2 text-sm text-zinc-500">
          Choose how to verify your creditworthiness. Wallet analysis and Sybil
          detection run in parallel either way.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onWalletOnly}
            className="rounded-lg border border-zinc-200 px-4 py-3 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <span className="font-medium">Wallet analysis only</span>
            <span className="mt-1 block text-zinc-500">
              On-chain history, DeFi behavior, ML scoring
            </span>
          </button>
          <button
            type="button"
            onClick={onWithBank}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40"
          >
            <span className="font-medium">Wallet + bank balance</span>
            <span className="mt-1 block text-zinc-500">
              Reclaim bank proof, then full on-chain score formula
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-sm text-zinc-500 hover:text-zinc-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
