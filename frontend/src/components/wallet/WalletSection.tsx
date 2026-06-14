"use client";

import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useState } from "react";
import { useDisconnect } from "wagmi";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletSection() {
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);

  const copyAddress = useCallback(async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <RainbowConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, mounted }) => {
        const connected = mounted && account && chain;

        return (
          <div
            className="flex items-center"
            {...(!mounted && {
              "aria-hidden": true,
              style: { opacity: 0, pointerEvents: "none" as const, userSelect: "none" as const },
            })}
          >
            {!connected ? (
              <button type="button" onClick={openConnectModal} className="btn-primary text-xs px-5 py-2">
                Connect Wallet
              </button>
            ) : chain.unsupported ? (
              <button
                type="button"
                onClick={openChainModal}
                className="rounded-full border border-red-400/40 bg-red-400/10 px-4 py-2 text-xs font-[650] text-red-400 transition-spring hover:scale-[1.03]"
              >
                Wrong Network
              </button>
            ) : (
              <div className="nav-pill gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => void copyAddress(account.address)}
                  title={account.address}
                  className="flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[12px] text-foreground transition-spring hover:bg-muted/40"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {copied ? "Copied!" : truncateAddress(account.address)}
                </button>
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="rounded-full px-3 py-1.5 text-[11px] font-[650] uppercase tracking-wider text-muted-foreground transition-spring hover:bg-muted/40 hover:text-foreground"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}
