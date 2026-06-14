"use client";

type Props = {
  message?: string;
};

export function ConnectWalletPrompt({
  message = "Connect your wallet to use CredFlow",
}: Props) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 card-padded text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="text-xs text-subtle">
        Use the Connect Wallet button in the header to sign in with MetaMask or another wallet.
      </p>
    </div>
  );
}
