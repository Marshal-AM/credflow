"use client";

import { useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits, parseEther, parseUnits } from "viem";
import {
  contractsByChain,
  LENDING_ABI,
  ORACLE_ABI,
  OAPP_ABI,
  SBT_ABI,
  WETH_ABI,
} from "@/lib/contracts";
import { collateralWeiForBorrow, maxLtvPercent } from "@/lib/loan-collateral";
import type { ChainKey } from "@/lib/chains";
import { chainIdByKey } from "@/lib/chains";

type Props = {
  chainKey: ChainKey;
};

function formatCollateralEth(eth: string): string {
  const n = Number(eth);
  if (!Number.isFinite(n)) return eth;
  if (n >= 0.001) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}

export function LoanPanel({ chainKey }: Props) {
  const cfg = contractsByChain[chainKey];
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [borrowAmount, setBorrowAmount] = useState("0.5");
  const [durationDays] = useState("30");
  const [status, setStatus] = useState<string | null>(null);

  const targetChainId = chainIdByKey[chainKey];
  const onCorrectChain = chainId === targetChainId;

  const { data: hubProfile } = useReadContract({
    address: cfg.sbt as `0x${string}`,
    abi: SBT_ABI,
    functionName: "getProfile",
    args: address ? [address] : undefined,
    chainId: targetChainId,
    query: { enabled: cfg.scoreSource === "sbt" && !!address && !!cfg.sbt },
  });

  const { data: spokeScore } = useReadContract({
    address: cfg.oapp as `0x${string}`,
    abi: OAPP_ABI,
    functionName: "getScore",
    args: address ? [address] : undefined,
    chainId: targetChainId,
    query: { enabled: cfg.scoreSource === "oapp" && !!address && !!cfg.oapp },
  });

  const score =
    cfg.scoreSource === "sbt"
      ? hubProfile
        ? Number(hubProfile.score)
        : 0
      : spokeScore !== undefined
        ? Number(spokeScore)
        : 0;

  const { data: maxLtv } = useReadContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "getLTVForScore",
    args: [score],
    chainId: targetChainId,
    query: { enabled: !!cfg.lending && score > 0 },
  });

  const oneEth = parseEther("1");
  const { data: ethUsd6 } = useReadContract({
    address: cfg.oracle as `0x${string}`,
    abi: ORACLE_ABI,
    functionName: "getValueUSD",
    args: [cfg.weth as `0x${string}`, oneEth],
    chainId: targetChainId,
    query: { enabled: !!cfg.oracle && !!cfg.weth },
  });

  const collateralEth = useMemo(() => {
    if (!maxLtv || !ethUsd6 || score <= 0) return null;
    try {
      const wei = collateralWeiForBorrow({
        borrowAmount,
        maxLtvBps: BigInt(maxLtv as number),
        ethUsd6: ethUsd6 as bigint,
      });
      return formatUnits(wei, 18);
    } catch {
      return null;
    }
  }, [borrowAmount, maxLtv, ethUsd6, score]);

  const { writeContractAsync, data: txHash, isPending } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  if (!cfg.lending) {
    return (
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-amber-600">Lending not deployed on {cfg.label}.</p>
      </div>
    );
  }

  async function handleBorrow() {
    if (!address || !cfg.lending || !collateralEth) return;
    setStatus(null);
    try {
      if (!onCorrectChain) {
        await switchChainAsync({ chainId: targetChainId });
      }

      const borrow = parseUnits(borrowAmount, 6);
      const coll = parseEther(collateralEth);

      setStatus("Wrapping ETH → WETH (if needed)…");
      try {
        await writeContractAsync({
          address: cfg.weth as `0x${string}`,
          abi: WETH_ABI,
          functionName: "deposit",
          value: coll,
          chainId: targetChainId,
        });
      } catch {
        /* may already have WETH */
      }

      setStatus("Approving WETH…");
      await writeContractAsync({
        address: cfg.weth as `0x${string}`,
        abi: WETH_ABI,
        functionName: "approve",
        args: [cfg.lending as `0x${string}`, coll],
        chainId: targetChainId,
      });

      setStatus("Requesting loan…");
      await writeContractAsync({
        address: cfg.lending as `0x${string}`,
        abi: LENDING_ABI,
        functionName: "requestLoan",
        args: [borrow, cfg.weth as `0x${string}`, coll, BigInt(durationDays)],
        chainId: targetChainId,
      });

      setStatus("Loan submitted successfully.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Borrow failed");
    }
  }

  const canBorrow = score > 0 && cfg.lending && isConnected && !!collateralEth;

  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 text-lg font-semibold">Borrow — {cfg.label}</h2>
      {!isConnected ? (
        <p className="text-sm text-zinc-500">Connect wallet to borrow.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {!onCorrectChain && (
            <p className="text-amber-600">Switch network to {cfg.label} to borrow.</p>
          )}
          <p>
            Score: <strong>{score || "—"}</strong>
            {maxLtv !== undefined && <> · Max LTV: {maxLtvPercent(Number(maxLtv))}%</>}
          </p>
          <label className="flex flex-col gap-1">
            Borrow ({cfg.borrowSymbol})
            <input
              className="rounded border px-2 py-1 dark:bg-zinc-900"
              value={borrowAmount}
              onChange={(e) => setBorrowAmount(e.target.value)}
            />
          </label>
          <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/50">
            <p className="text-xs text-zinc-500">Required WETH collateral</p>
            <p className="font-semibold tabular-nums">
              {collateralEth ? `${formatCollateralEth(collateralEth)} ETH` : "—"}
            </p>
            {ethUsd6 != null && (
              <p className="text-xs text-zinc-500">ETH ≈ ${formatUnits(ethUsd6 as bigint, 6)}</p>
            )}
          </div>
          <button
            type="button"
            disabled={!canBorrow || isPending || confirming}
            onClick={handleBorrow}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {isPending || confirming ? "Processing…" : `Borrow on ${cfg.label}`}
          </button>
          {status && <p className="text-zinc-600 dark:text-zinc-400">{status}</p>}
        </div>
      )}
    </div>
  );
}
