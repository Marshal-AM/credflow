"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ScorePanel } from "@/components/ScorePanel";
import { LoanPanel } from "@/components/LoanPanel";
import type { ChainKey } from "@/lib/chains";
import { contractsByChain } from "@/lib/contracts";

const CHAIN_OPTIONS: { key: ChainKey; label: string }[] = [
  { key: "hub", label: "Robinhood Hub" },
  { key: "arbitrum", label: "Arbitrum Sepolia" },
  { key: "base", label: "Base Sepolia" },
];

export default function Home() {
  const [chainKey, setChainKey] = useState<ChainKey>("hub");

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">CredFlow</h1>
            <p className="text-sm text-zinc-500">Multi-chain credit lending</p>
          </div>
          <ConnectButton />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap gap-2">
          {CHAIN_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setChainKey(key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                chainKey === key
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-sm text-zinc-500">
          {contractsByChain[chainKey].label} — borrow token{" "}
          {contractsByChain[chainKey].borrowSymbol}
          {chainKey !== "hub" && " (score via LayerZero)"}
        </p>

        <ScorePanel chainKey={chainKey} />
        <LoanPanel chainKey={chainKey} />
      </main>
    </div>
  );
}
