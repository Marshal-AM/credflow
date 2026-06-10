import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  maxUint256,
  parseEther,
  parseUnits,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { getFrontendAccount } from "@/lib/wallet-server";
import {
  arbitrumSepolia,
  baseSepolia,
  robinhoodTestnet,
  type ChainKey,
} from "@/lib/chains";
import {
  contractsByChain,
  ERC20_ABI,
  LENDING_ABI,
  OAPP_ABI,
  ORACLE_ABI,
  SBT_ABI,
  WETH_ABI,
} from "@/lib/contracts";
import { collateralWeiForBorrow, maxLtvPercent } from "@/lib/loan-collateral";
import { sendWalletContractWrite } from "@/lib/wallet-tx";

function rpcForChain(chainKey: ChainKey): string {
  switch (chainKey) {
    case "hub":
      return (
        process.env.NEXT_PUBLIC_RPC_ROBINHOOD ||
        process.env.RPC_ROBINHOOD ||
        "https://rpc.testnet.chain.robinhood.com"
      );
    case "arbitrum":
      return (
        process.env.RPC_ARBITRUM ||
        process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA ||
        "https://sepolia-rollup.arbitrum.io/rpc"
      );
    case "base":
      return (
        process.env.RPC_BASE ||
        process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA ||
        "https://sepolia.base.org"
      );
  }
}

function chainForKey(chainKey: ChainKey) {
  switch (chainKey) {
    case "hub":
      return robinhoodTestnet;
    case "arbitrum":
      return arbitrumSepolia;
    case "base":
      return baseSepolia;
  }
}

export function getPublicClient(chainKey: ChainKey): PublicClient {
  return createPublicClient({
    chain: chainForKey(chainKey),
    transport: http(rpcForChain(chainKey)),
  }) as PublicClient;
}

export function getWalletClient(chainKey: ChainKey): WalletClient {
  return createWalletClient({
    account: getFrontendAccount(),
    chain: chainForKey(chainKey),
    transport: http(rpcForChain(chainKey)),
  });
}

export type LoanOnChain = {
  loanId: bigint;
  borrower: `0x${string}`;
  collateralToken: `0x${string}`;
  collateralAmount: bigint;
  borrowedAmount: bigint;
  interestRate: bigint;
  startTime: bigint;
  dueTime: bigint;
  maxLTV: bigint;
  active: boolean;
  interest: bigint;
  totalDue: bigint;
};

export type ChainLoanSummary = {
  chainKey: ChainKey;
  label: string;
  score: number;
  scoreSource: "sbt" | "oapp";
  loanActive: boolean;
  /** LayerZero OApp / SBT mirror — can stay true after hub repay until repaid LZ lands */
  lzLoanActive: boolean;
  blacklisted: boolean;
  activeLoanId: bigint;
  loan: LoanOnChain | null;
  eligible: boolean;
  eligibilityReason: string | null;
};

export async function readChainLoanSummary(
  chainKey: ChainKey,
  wallet: `0x${string}`
): Promise<ChainLoanSummary> {
  const cfg = contractsByChain[chainKey];
  const client = getPublicClient(chainKey);
  let score = 0;
  let loanActive = false;
  let lzLoanActive = false;
  let blacklisted = false;

  if (cfg.scoreSource === "sbt" && cfg.sbt) {
    const profile = await client.readContract({
      address: cfg.sbt as `0x${string}`,
      abi: SBT_ABI,
      functionName: "getProfile",
      args: [wallet],
    });
    score = Number(profile.score);
    loanActive = profile.loanActive;
    lzLoanActive = profile.loanActive;
    blacklisted = profile.defaultCount > 0;
  } else if (cfg.oapp) {
    score = Number(
      await client.readContract({
        address: cfg.oapp as `0x${string}`,
        abi: OAPP_ABI,
        functionName: "getScore",
        args: [wallet],
      })
    );
    lzLoanActive = await client.readContract({
      address: cfg.oapp as `0x${string}`,
      abi: OAPP_ABI,
      functionName: "isLoanActive",
      args: [wallet],
    });
    loanActive = lzLoanActive;
    blacklisted = await client.readContract({
      address: cfg.oapp as `0x${string}`,
      abi: OAPP_ABI,
      functionName: "isBlacklisted",
      args: [wallet],
    });
  }

  const activeLoanId = cfg.lending
    ? await client.readContract({
        address: cfg.lending as `0x${string}`,
        abi: LENDING_ABI,
        functionName: "activeLoanId",
        args: [wallet],
      })
    : 0n;

  let resolvedLoanId = activeLoanId;
  if (resolvedLoanId === 0n && cfg.lending) {
    resolvedLoanId = await findActiveLoanIdForBorrower(client, cfg.lending as `0x${string}`, wallet);
  }

  let loan: LoanOnChain | null = null;
  if (resolvedLoanId > 0n && cfg.lending) {
    loan = await loadLoanOnChain(client, cfg.lending as `0x${string}`, resolvedLoanId);
    if (!loan) {
      resolvedLoanId = 0n;
    }
  }

  let eligible = false;
  let eligibilityReason: string | null = null;
  if (!cfg.lending) {
    eligibilityReason = "Lending not deployed";
  } else if (score <= 0) {
    eligibilityReason =
      chainKey === "hub"
        ? "Complete Account score and mint SBT first"
        : "Score not synced — complete Account score first";
  } else if (blacklisted) {
    eligibilityReason = "Wallet blacklisted";
  } else if (loan?.active || resolvedLoanId > 0n) {
    eligibilityReason = "Active loan on this chain";
  } else if (chainKey === "hub" && loanActive) {
    eligibilityReason = "Active loan on Robinhood hub";
  } else {
    eligible = true;
  }

  return {
    chainKey,
    label: cfg.label,
    score,
    scoreSource: cfg.scoreSource,
    loanActive: Boolean(loan?.active || resolvedLoanId > 0n),
    lzLoanActive,
    blacklisted,
    activeLoanId: resolvedLoanId,
    loan,
    eligible,
    eligibilityReason,
  };
}

async function findActiveLoanIdForBorrower(
  client: PublicClient,
  lending: `0x${string}`,
  wallet: `0x${string}`
): Promise<bigint> {
  try {
    const counter = await client.readContract({
      address: lending,
      abi: LENDING_ABI,
      functionName: "loanCounter",
    });
    for (let loanId = 1n; loanId <= counter; loanId++) {
      const raw = await client.readContract({
        address: lending,
        abi: LENDING_ABI,
        functionName: "loans",
        args: [loanId],
      });
      if (
        raw.active &&
        raw.borrower.toLowerCase() === wallet.toLowerCase()
      ) {
        return loanId;
      }
    }
  } catch {
    /* fallback scan optional */
  }
  return 0n;
}

async function loadLoanOnChain(
  client: PublicClient,
  lending: `0x${string}`,
  loanId: bigint
): Promise<LoanOnChain | null> {
  const raw = await client.readContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "loans",
    args: [loanId],
  });
  if (!raw.active) {
    return null;
  }
  let interest = 0n;
  try {
    interest = await client.readContract({
      address: lending,
      abi: LENDING_ABI,
      functionName: "calculateInterest",
      args: [raw],
    });
  } catch {
    interest = 0n;
  }
  return {
    loanId,
    borrower: raw.borrower,
    collateralToken: raw.collateralToken,
    collateralAmount: raw.collateralAmount,
    borrowedAmount: raw.borrowedAmount,
    interestRate: raw.interestRate,
    startTime: raw.startTime,
    dueTime: raw.dueTime,
    maxLTV: raw.maxLTV,
    active: raw.active,
    interest,
    totalDue: raw.borrowedAmount + interest,
  };
}

export type BorrowCollateralQuote = {
  collateralWei: bigint;
  collateralEth: string;
  maxLtvBps: number;
  maxLtvPct: string;
  ethUsd: string;
};

export async function computeRequiredCollateral(
  chainKey: ChainKey,
  score: number,
  borrowAmount: string
): Promise<BorrowCollateralQuote> {
  const cfg = contractsByChain[chainKey];
  if (!cfg.lending) throw new Error(`Lending not deployed on ${cfg.label}`);
  if (!cfg.oracle || !cfg.weth) throw new Error(`Oracle not configured on ${cfg.label}`);
  if (score <= 0) throw new Error("No credit score on this chain");

  const client = getPublicClient(chainKey);
  const maxLtv = await client.readContract({
    address: cfg.lending as `0x${string}`,
    abi: LENDING_ABI,
    functionName: "getLTVForScore",
    args: [score],
  });

  const maxLtvBps = Number(maxLtv);
  if (maxLtvBps <= 0) {
    throw new Error("Credit score below minimum LTV tier (500+)");
  }

  const oneEth = parseEther("1");
  const ethUsd6 = await client.readContract({
    address: cfg.oracle as `0x${string}`,
    abi: ORACLE_ABI,
    functionName: "getValueUSD",
    args: [cfg.weth as `0x${string}`, oneEth],
  });

  const collateralWei = collateralWeiForBorrow({
    borrowAmount,
    maxLtvBps: maxLtv,
    ethUsd6,
  });

  return {
    collateralWei,
    collateralEth: formatEther(collateralWei),
    maxLtvBps,
    maxLtvPct: maxLtvPercent(maxLtvBps),
    ethUsd: formatUnits(ethUsd6, 6),
  };
}

export async function borrowLoan(params: {
  chainKey: ChainKey;
  borrowAmount: string;
  durationDays: number;
  score: number;
  collateralEth?: string;
}): Promise<{ txHash: Hash; loanId: bigint | null; collateralEth: string }> {
  const { chainKey, borrowAmount, durationDays, score } = params;
  const quote = await computeRequiredCollateral(chainKey, score, borrowAmount);
  const collateralEth = params.collateralEth ?? quote.collateralEth;
  const cfg = contractsByChain[chainKey];
  if (!cfg.lending) throw new Error(`Lending not deployed on ${cfg.label}`);

  const wallet = getFrontendAccount();
  const publicClient = getPublicClient(chainKey);
  const walletClient = getWalletClient(chainKey);
  const borrow = parseUnits(borrowAmount, 6);
  const collateral = parseEther(collateralEth);
  const weth = cfg.weth as `0x${string}`;
  const lending = cfg.lending as `0x${string}`;

  const chain = chainForKey(chainKey);

  try {
    await sendWalletContractWrite(publicClient, walletClient, {
      address: weth,
      abi: WETH_ABI,
      functionName: "deposit",
      value: collateral,
      account: wallet,
      chain,
    });
  } catch {
    /* may already have WETH */
  }

  await sendWalletContractWrite(publicClient, walletClient, {
    address: weth,
    abi: WETH_ABI,
    functionName: "approve",
    args: [lending, collateral],
    account: wallet,
    chain,
  });

  await publicClient.simulateContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "requestLoan",
    args: [borrow, weth, collateral, BigInt(durationDays)],
    account: wallet.address,
  });

  const loanHash = await sendWalletContractWrite(publicClient, walletClient, {
    address: lending,
    abi: LENDING_ABI,
    functionName: "requestLoan",
    args: [borrow, weth, collateral, BigInt(durationDays)],
    account: wallet,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: loanHash });

  if (receipt.status !== "success") {
    throw new Error(
      "Borrow transaction reverted on-chain (check collateral, pool liquidity, or score LTV)"
    );
  }

  const activeLoanId = await publicClient.readContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "activeLoanId",
    args: [wallet.address],
  });

  if (activeLoanId === 0n) {
    throw new Error("Borrow tx mined but no active loan was created — try again");
  }

  return {
    txHash: receipt.transactionHash,
    loanId: activeLoanId,
    collateralEth,
  };
}

async function ensureBorrowTokenAllowance(
  chainKey: ChainKey,
  borrowToken: `0x${string}`,
  lending: `0x${string}`,
  wallet: ReturnType<typeof getFrontendAccount>,
  publicClient: PublicClient,
  walletClient: WalletClient,
  minRequired: bigint
): Promise<void> {
  const chain = chainForKey(chainKey);
  let allowance = await publicClient.readContract({
    address: borrowToken,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [wallet.address, lending],
  });

  if (allowance >= minRequired && allowance >= maxUint256 / 2n) {
    return;
  }

  // USDC (and similar) often require reset to 0 before a new non-zero approve.
  if (allowance > 0n) {
    await sendWalletContractWrite(publicClient, walletClient, {
      address: borrowToken,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [lending, 0n],
      account: wallet,
      chain,
    });
  }

  await sendWalletContractWrite(publicClient, walletClient, {
    address: borrowToken,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [lending, maxUint256],
    account: wallet,
    chain,
  });

  allowance = await publicClient.readContract({
    address: borrowToken,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [wallet.address, lending],
  });
  if (allowance < minRequired) {
    throw new Error(
      `Borrow token allowance still too low after approve (${allowance.toString()} < ${minRequired.toString()}). ` +
        `Token ${borrowToken} on ${cfgLabel(chainKey)}.`
    );
  }
}

function cfgLabel(chainKey: ChainKey): string {
  return contractsByChain[chainKey].label;
}

export type RepayLoanResult = {
  txHash: Hash;
  loanId: bigint;
  collateralWei: bigint;
  collateralEth: string;
  totalRepaidWei: bigint;
  totalRepaidFormatted: string;
  borrowSymbol: string;
  receipt: {
    blockNumber: string;
    status: "success" | "reverted";
    gasUsed: string;
  };
};

export async function repayLoan(chainKey: ChainKey): Promise<RepayLoanResult> {
  const cfg = contractsByChain[chainKey];
  if (!cfg.lending) throw new Error(`Lending not deployed on ${cfg.label}`);

  const wallet = getFrontendAccount();
  const publicClient = getPublicClient(chainKey);
  const walletClient = getWalletClient(chainKey);
  const lending = cfg.lending as `0x${string}`;
  const chain = chainForKey(chainKey);

  const loanId = await publicClient.readContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "activeLoanId",
    args: [wallet.address],
  });
  if (loanId === 0n) throw new Error("No active loan");

  const borrowToken = (await publicClient.readContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "borrowToken",
  })) as `0x${string}`;

  const raw = await publicClient.readContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "loans",
    args: [loanId],
  });
  const interest = await publicClient.readContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "calculateInterest",
    args: [raw],
  });
  const totalDue = raw.borrowedAmount + interest;

  const balance = await publicClient.readContract({
    address: borrowToken,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [wallet.address],
  });
  if (balance < totalDue) {
    throw new Error(
      `Insufficient ${cfg.borrowSymbol} balance (${balance.toString()} < ${totalDue.toString()} wei)`
    );
  }

  await ensureBorrowTokenAllowance(
    chainKey,
    borrowToken,
    lending,
    wallet,
    publicClient,
    walletClient,
    totalDue
  );

  const { request } = await publicClient.simulateContract({
    address: lending,
    abi: LENDING_ABI,
    functionName: "repayLoan",
    args: [loanId],
    account: wallet,
  });

  const repayHash = await sendWalletContractWrite(publicClient, walletClient, {
    ...request,
    account: wallet,
    chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: repayHash });
  if (receipt.status !== "success") {
    throw new Error("Repay transaction reverted on-chain");
  }

  const borrowDecimals = cfg.borrowSymbol === "USDG" ? 6 : 6;
  return {
    txHash: repayHash,
    loanId,
    collateralWei: raw.collateralAmount,
    collateralEth: formatEther(raw.collateralAmount),
    totalRepaidWei: totalDue,
    totalRepaidFormatted: formatUnits(totalDue, borrowDecimals),
    borrowSymbol: cfg.borrowSymbol,
    receipt: {
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}
