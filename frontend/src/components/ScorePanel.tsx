"use client";

import { useAccount, useReadContract } from "wagmi";
import { contractsByChain, OAPP_ABI, SBT_ABI, type ChainContracts } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";

type Props = {
  chainKey: ChainKey;
};

function HubScore({ cfg, address }: { cfg: ChainContracts; address: `0x${string}` }) {
  const { data: hasProfile } = useReadContract({
    address: cfg.sbt as `0x${string}`,
    abi: SBT_ABI,
    functionName: "hasProfile",
    args: [address],
    chainId: cfg.chainId,
  });

  const { data: profile } = useReadContract({
    address: cfg.sbt as `0x${string}`,
    abi: SBT_ABI,
    functionName: "getProfile",
    args: [address],
    chainId: cfg.chainId,
    query: { enabled: !!hasProfile },
  });

  if (!hasProfile) {
    return <p className="text-sm text-zinc-500">No SBT on hub — run underwriter agent first.</p>;
  }

  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="text-zinc-500">Score:</span>{" "}
        <strong>{profile ? Number(profile.score) : "—"}</strong>
      </p>
      <p>
        <span className="text-zinc-500">Loan active:</span>{" "}
        {profile ? (profile.loanActive ? "yes" : "no") : "—"}
      </p>
    </div>
  );
}

function SpokeScore({ cfg, address }: { cfg: ChainContracts; address: `0x${string}` }) {
  const { data: score } = useReadContract({
    address: cfg.oapp as `0x${string}`,
    abi: OAPP_ABI,
    functionName: "getScore",
    args: [address],
    chainId: cfg.chainId,
  });

  const { data: blacklisted } = useReadContract({
    address: cfg.oapp as `0x${string}`,
    abi: OAPP_ABI,
    functionName: "isBlacklisted",
    args: [address],
    chainId: cfg.chainId,
  });

  const { data: loanActive } = useReadContract({
    address: cfg.oapp as `0x${string}`,
    abi: OAPP_ABI,
    functionName: "isLoanActive",
    args: [address],
    chainId: cfg.chainId,
  });

  const scoreNum = score !== undefined ? Number(score) : 0;

  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="text-zinc-500">LZ score:</span>{" "}
        <strong>{scoreNum || "—"}</strong>
        {scoreNum === 0 && (
          <span className="ml-2 text-amber-600">Not synced — run agent:sync</span>
        )}
      </p>
      <p>
        <span className="text-zinc-500">Blacklisted:</span> {blacklisted ? "yes" : "no"}
      </p>
      <p>
        <span className="text-zinc-500">Cross-chain loan:</span> {loanActive ? "active" : "none"}
      </p>
    </div>
  );
}

export function ScorePanel({ chainKey }: Props) {
  const { address, isConnected } = useAccount();
  const cfg = contractsByChain[chainKey];

  if (!isConnected || !address) {
    return <p className="text-sm text-zinc-500">Connect wallet to view credit score.</p>;
  }

  if (chainKey !== "hub" && !cfg.lending) {
    return (
      <p className="text-sm text-amber-600">
        Spoke lending not deployed yet for {cfg.label}.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 text-lg font-semibold">Credit Score — {cfg.label}</h2>
      {cfg.scoreSource === "sbt" ? (
        <HubScore cfg={cfg} address={address} />
      ) : (
        <SpokeScore cfg={cfg} address={address} />
      )}
    </div>
  );
}
