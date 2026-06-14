import type { Hash } from "viem";
import { formatUnits, maxUint256, parseEther, parseUnits } from "viem";
import type { useWriteContract } from "wagmi";
import { contractsByChain, ERC20_ABI, LENDING_ABI, WETH_ABI } from "@/lib/contracts";
import type { ChainKey } from "@/lib/chains";
import { chainIdByKey } from "@/lib/chains";

type WriteContractAsync = ReturnType<typeof useWriteContract>["writeContractAsync"];

export async function clientBorrowLoan(params: {
  chainKey: ChainKey;
  borrowAmount: string;
  durationDays: number;
  collateralEth: string;
  writeContractAsync: WriteContractAsync;
  ensureChain: () => Promise<void>;
}): Promise<{ txHash: Hash; collateralEth: string }> {
  const { chainKey, borrowAmount, durationDays, collateralEth, writeContractAsync, ensureChain } =
    params;
  const cfg = contractsByChain[chainKey];
  if (!cfg.lending) throw new Error(`Lending not deployed on ${cfg.label}`);

  await ensureChain();
  const targetChainId = chainIdByKey[chainKey];
  const borrow = parseUnits(borrowAmount, 6);
  const collateral = parseEther(collateralEth);
  const weth = cfg.weth as `0x${string}`;
  const lending = cfg.lending as `0x${string}`;

  try {
    await writeContractAsync({
      address: weth,
      abi: WETH_ABI,
      functionName: "deposit",
      value: collateral,
      chainId: targetChainId,
    });
  } catch {
    /* may already have WETH */
  }

  await writeContractAsync({
    address: weth,
    abi: WETH_ABI,
    functionName: "approve",
    args: [lending, collateral],
    chainId: targetChainId,
  });

  const txHash = await writeContractAsync({
    address: lending,
    abi: LENDING_ABI,
    functionName: "requestLoan",
    args: [borrow, weth, collateral, BigInt(durationDays)],
    chainId: targetChainId,
  });

  return { txHash, collateralEth };
}

export async function clientRepayLoan(params: {
  chainKey: ChainKey;
  loanId: bigint;
  totalDue: bigint;
  borrowToken: `0x${string}`;
  writeContractAsync: WriteContractAsync;
  ensureChain: () => Promise<void>;
}): Promise<{ txHash: Hash; totalRepaidFormatted: string; borrowSymbol: string }> {
  const { chainKey, loanId, totalDue, borrowToken, writeContractAsync, ensureChain } = params;
  const cfg = contractsByChain[chainKey];
  if (!cfg.lending) throw new Error(`Lending not deployed on ${cfg.label}`);

  await ensureChain();
  const targetChainId = chainIdByKey[chainKey];
  const lending = cfg.lending as `0x${string}`;

  try {
    await writeContractAsync({
      address: borrowToken,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [lending, 0n],
      chainId: targetChainId,
    });
  } catch {
    /* some tokens skip zero reset */
  }

  await writeContractAsync({
    address: borrowToken,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [lending, maxUint256],
    chainId: targetChainId,
  });

  const txHash = await writeContractAsync({
    address: lending,
    abi: LENDING_ABI,
    functionName: "repayLoan",
    args: [loanId],
    chainId: targetChainId,
  });

  return {
    txHash,
    totalRepaidFormatted: formatUnits(totalDue, 6),
    borrowSymbol: cfg.borrowSymbol,
  };
}

export function formatCollateralEth(eth: string): string {
  const n = Number(eth);
  if (!Number.isFinite(n)) return eth;
  if (n >= 0.001) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}
