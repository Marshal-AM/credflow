import {
  createPublicClient,
  fallback,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type PublicClient,
} from "viem";
import {
  arbitrumSepolia,
  baseSepolia,
  robinhoodTestnet,
  type ChainKey,
} from "@/lib/chains";
import { isHubWalletBlacklisted, isSpokeWalletBlacklisted } from "@/lib/wallet-blacklist";
import {
  contractsByChain,
  LENDING_ABI,
  OAPP_ABI,
  ORACLE_ABI,
  SBT_ABI,
  WETH_ABI,
} from "@/lib/contracts";
import { collateralWeiForBorrow, maxLtvPercent } from "@/lib/loan-collateral";

const RPC_TIMEOUT_MS = 12_000;

/** Public endpoints used when primary Alchemy/custom RPC stalls or errors. */
const PUBLIC_RPC_FALLBACKS: Record<ChainKey, string[]> = {
  hub: [],
  arbitrum: ["https://sepolia-rollup.arbitrum.io/rpc"],
  base: ["https://sepolia.base.org"],
};

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

function rpcUrlsForChain(chainKey: ChainKey): string[] {
  const primary = rpcForChain(chainKey);
  const fallbacks = PUBLIC_RPC_FALLBACKS[chainKey].filter((url) => url !== primary);
  return [...new Set([primary, ...fallbacks])];
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
  const urls = rpcUrlsForChain(chainKey);
  const transport =
    urls.length > 1
      ? fallback(urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS })))
      : http(urls[0], { timeout: RPC_TIMEOUT_MS });

  return createPublicClient({
    chain: chainForKey(chainKey),
    transport,
  }) as PublicClient;
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
    const [profile, hubExplicitBlacklisted] = await Promise.all([
      client.readContract({
        address: cfg.sbt as `0x${string}`,
        abi: SBT_ABI,
        functionName: "getProfile",
        args: [wallet],
      }),
      client.readContract({
        address: cfg.sbt as `0x${string}`,
        abi: SBT_ABI,
        functionName: "isBlacklisted",
        args: [wallet],
      }),
    ]);
    score = Number(profile.score);
    loanActive = profile.loanActive;
    lzLoanActive = profile.loanActive;
    blacklisted = isHubWalletBlacklisted(profile.defaultCount, hubExplicitBlacklisted);
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
    const spokeExplicitBlacklisted = await client.readContract({
      address: cfg.oapp as `0x${string}`,
      abi: OAPP_ABI,
      functionName: "isBlacklisted",
      args: [wallet],
    });
    blacklisted = isSpokeWalletBlacklisted(spokeExplicitBlacklisted);
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
    eligibilityReason =
      chainKey === "hub"
        ? "Wallet blacklisted or prior default on hub"
        : "Wallet blacklisted on this spoke (LayerZero default)";
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
