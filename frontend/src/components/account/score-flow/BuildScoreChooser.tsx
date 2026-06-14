type Props = {
  onWalletOnly: () => void;
  onWithBank: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
  cancelLabel?: string;
};

const CARD_CLASS =
  "group flex flex-col items-center rounded-lg border border-border/50 bg-muted/15 px-5 py-6 text-center transition-colors hover:border-primary/35 hover:bg-primary/10";

const ICON_BOX_CLASS =
  "flex items-center justify-center rounded-md bg-muted/40 text-muted-foreground transition-colors group-hover:bg-primary/20 group-hover:text-primary";

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function BankIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M5 21V10M9 21V10M13 21V10M17 21V10" />
      <path d="m2 10 10-7 10 7" />
    </svg>
  );
}

function OptionIcon({ variant }: { variant: "wallet" | "wallet-bank" }) {
  if (variant === "wallet") {
    return (
      <div className={`mb-4 h-12 w-12 ${ICON_BOX_CLASS}`}>
        <WalletIcon className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center justify-center gap-2">
      <div className={`h-11 w-11 ${ICON_BOX_CLASS}`}>
        <WalletIcon className="h-5 w-5" />
      </div>
      <span
        className="text-xs text-muted-foreground transition-colors group-hover:text-primary"
        aria-hidden
      >
        +
      </span>
      <div className={`h-11 w-11 ${ICON_BOX_CLASS}`}>
        <BankIcon className="h-5 w-5" />
      </div>
    </div>
  );
}

function SourceOptionCard({
  variant,
  title,
  description,
  onClick,
}: {
  variant: "wallet" | "wallet-bank";
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={CARD_CLASS}>
      <OptionIcon variant={variant} />
      <span className="text-base font-[650] text-foreground">{title}</span>
      <span className="mt-2 max-w-[14rem] text-sm leading-relaxed text-muted-foreground transition-colors group-hover:text-primary">
        {description}
      </span>
    </button>
  );
}

export function BuildScoreChooser({
  onWalletOnly,
  onWithBank,
  onCancel,
  showCancel = true,
  cancelLabel = "Cancel",
}: Props) {
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center px-4 py-8 text-center">
      <p className="section-label">Build your CredScore</p>
      <h3 className="mt-2 text-xl font-[650] tracking-tight">Choose your data sources</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Bank verification can improve your score and borrowing limit.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <SourceOptionCard
          variant="wallet"
          title="Wallet only"
          description="On-chain activity and sybil graph screening."
          onClick={onWalletOnly}
        />
        <SourceOptionCard
          variant="wallet-bank"
          title="Wallet + bank account"
          description="Adds verified bank balance via Reclaim."
          onClick={onWithBank}
        />
      </div>

      {showCancel && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-6 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {cancelLabel}
        </button>
      )}
    </div>
  );
}
