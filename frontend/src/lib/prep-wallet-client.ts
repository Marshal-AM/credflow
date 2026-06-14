import {
  type Address,
  type Hash,
  type PublicClient,
  encodeAbiParameters,
  getAddress,
  keccak256,
  maxUint256,
  parseEther,
  parseUnits,
} from "viem";
import type { useSendTransaction, useWriteContract } from "wagmi";
import { chainIdByKey, type ChainKey } from "@/lib/chains";
import { ERC20_ABI, WETH_ABI } from "@/lib/contracts";
import { sendTransactionWithGas, writeContractWithGas } from "@/lib/wallet-tx";

export type PrepWalletStepId =
  | "arbitrum-activity"
  | "base-activity"
  | "base-aave"
  | "arbitrum-aave"
  | "morpho";

export type PrepWalletStep = {
  id: PrepWalletStepId;
  label: string;
  description: string;
  network: "arbitrum" | "base";
  order: number;
};

export const PREP_WALLET_STEPS: PrepWalletStep[] = [
  { id: "arbitrum-activity", order: 1, label: "Arbitrum transfers", description: "ETH transfers + WETH deposit", network: "arbitrum" },
  { id: "base-activity", order: 2, label: "Base transfers", description: "ETH transfers + WETH deposit", network: "base" },
  { id: "base-aave", order: 3, label: "Base Aave", description: "Supply WETH, borrow & repay USDC", network: "base" },
  { id: "arbitrum-aave", order: 4, label: "Arbitrum Aave", description: "Supply WETH, borrow & repay USDC", network: "arbitrum" },
  { id: "morpho", order: 5, label: "Base Morpho", description: "Collateral, borrow, repay, withdraw", network: "base" },
];

const TX_DELAY_MS = 10_000;
const VARIABLE_RATE_MODE = 2;

const ACTIVITY_RECIPIENTS = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x000000000000000000000000000000000000dEaD",
] as const;

const ARBITRUM = {
  weth: "0x1dF462e2712496373A347f8ad10802a5E95f053D" as Address,
  aavePool: "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff" as Address,
  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address,
  aWeth: "0xf5f17EbE81E516Dc7cB38D61908EC252F150CE60" as Address,
};

const BASE = {
  weth: "0x4200000000000000000000000000000000000006" as Address,
  aavePool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27" as Address,
  usdc: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f" as Address,
  aWeth: "0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb" as Address,
  morpho: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as Address,
  morphoIrm: "0x46415998764C29aB2a25CbeA6254146D50D22687" as Address,
  morphoOracle: "0xc1b505f7ce2dc56abf5dc1495d6f66636937b125" as Address,
  morphoLltv: 860000000000000000n,
};

const AAVE_POOL_ABI = [
  {
    type: "function",
    name: "supply",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "borrow",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "repay",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getUserAccountData",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

const MORPHO_ABI = [
  {
    type: "function",
    name: "supplyCollateral",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "borrow",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [
      { name: "assetsBorrowed", type: "uint256" },
      { name: "sharesBorrowed", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "repay",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "assetsRepaid", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawCollateral",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createMarket",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "market",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "totalSupplyAssets", type: "uint128" },
      { name: "totalSupplyShares", type: "uint128" },
      { name: "totalBorrowAssets", type: "uint128" },
      { name: "totalBorrowShares", type: "uint128" },
      { name: "lastUpdate", type: "uint128" },
      { name: "fee", type: "uint128" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "position",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "supplyShares", type: "uint256" },
      { name: "borrowShares", type: "uint128" },
      { name: "collateral", type: "uint128" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "supply",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ],
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "assetsSupplied", type: "uint256" },
      { name: "sharesSupplied", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

const MORPHO_ORACLE_ABI = [
  {
    type: "function",
    name: "price",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export type PrepRunner = {
  address: Address;
  writeContractAsync: ReturnType<typeof useWriteContract>["writeContractAsync"];
  sendTransactionAsync: ReturnType<typeof useSendTransaction>["sendTransactionAsync"];
  publicClient: PublicClient;
  ensureChain: (network: "arbitrum" | "base") => Promise<number>;
};

export type PrepStepResult = {
  txCount: number;
  txs: Hash[];
  durationMs: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chainKeyForNetwork(network: "arbitrum" | "base"): ChainKey {
  return network === "arbitrum" ? "arbitrum" : "base";
}

async function waitAfterTx() {
  if (TX_DELAY_MS > 0) await sleep(TX_DELAY_MS);
}

type WriteContractArgs = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

async function writeAndWait(
  runner: PrepRunner,
  chainId: number,
  args: WriteContractArgs
): Promise<Hash> {
  const hash = await writeContractWithGas(runner.publicClient, runner.writeContractAsync, {
    ...args,
    chainId,
  } as Parameters<PrepRunner["writeContractAsync"]>[0]);
  await runner.publicClient.waitForTransactionReceipt({ hash });
  await waitAfterTx();
  return hash;
}

async function sendAndWait(
  runner: PrepRunner,
  chainId: number,
  to: Address,
  value: bigint
): Promise<Hash> {
  const hash = await sendTransactionWithGas(runner.publicClient, runner.sendTransactionAsync, {
    to,
    value,
    chainId,
  });
  await runner.publicClient.waitForTransactionReceipt({ hash });
  await waitAfterTx();
  return hash;
}

async function ensureAllowance(
  runner: PrepRunner,
  chainId: number,
  token: Address,
  spender: Address,
  amount: bigint,
  txs: Hash[]
) {
  const allowance = await runner.publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [runner.address, spender],
  });
  if (allowance >= amount) return;
  txs.push(
    await writeAndWait(runner, chainId, {
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, maxUint256],
    })
  );
}

async function runActivity(
  runner: PrepRunner,
  network: "arbitrum" | "base",
  weth: Address
): Promise<PrepStepResult> {
  const started = Date.now();
  const chainId = await runner.ensureChain(network);
  const txs: Hash[] = [];
  const transferWei = parseEther("0.00001");
  const wethDepositWei = parseEther("0.00001");
  const minWei = parseEther("0.0005");

  const balance = await runner.publicClient.getBalance({ address: runner.address });
  if (balance < minWei) {
    throw new Error(`Need at least 0.0005 ETH on ${network}`);
  }

  for (const to of ACTIVITY_RECIPIENTS) {
    txs.push(await sendAndWait(runner, chainId, getAddress(to), transferWei));
  }

  const code = await runner.publicClient.getBytecode({ address: weth });
  if (code && code !== "0x") {
    txs.push(
      await writeAndWait(runner, chainId, {
        address: weth,
        abi: WETH_ABI,
        functionName: "deposit",
        value: wethDepositWei,
      })
    );
  }

  return { txCount: txs.length, txs, durationMs: Date.now() - started };
}

async function runAave(
  runner: PrepRunner,
  network: "arbitrum" | "base",
  cfg: typeof ARBITRUM | typeof BASE
): Promise<PrepStepResult> {
  const started = Date.now();
  const chainId = await runner.ensureChain(network);
  const txs: Hash[] = [];
  const supplyWei = parseEther("0.001");
  const borrowUnits = parseUnits("0.1", 6);
  const minGasWei = parseEther("0.001");

  const ethBal = await runner.publicClient.getBalance({ address: runner.address });
  if (ethBal < minGasWei) {
    throw new Error(`Need at least 0.001 ETH for gas on ${network}`);
  }

  const wethBal = (await runner.publicClient.readContract({
    address: cfg.weth,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [runner.address],
  })) as bigint;

  const aWethBal = (await runner.publicClient.readContract({
    address: cfg.aWeth,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [runner.address],
  })) as bigint;

  let account: readonly [bigint, bigint, bigint, bigint, bigint, bigint] | null = null;
  try {
    account = await runner.publicClient.readContract({
      address: cfg.aavePool,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [runner.address],
    });
  } catch {
    account = null;
  }

  const hasCollateral = aWethBal >= supplyWei || (account?.[0] ?? 0n) > 0n;

  if (!hasCollateral && wethBal < supplyWei) {
    const wrapAmount = supplyWei - wethBal;
    if (ethBal < wrapAmount) throw new Error("Insufficient ETH to wrap WETH");
    txs.push(
      await writeAndWait(runner, chainId, {
        address: cfg.weth,
        abi: WETH_ABI,
        functionName: "deposit",
        value: wrapAmount,
      })
    );
  }

  if (!hasCollateral) {
    await ensureAllowance(runner, chainId, cfg.weth, cfg.aavePool, supplyWei, txs);
    txs.push(
      await writeAndWait(runner, chainId, {
        address: cfg.aavePool,
        abi: AAVE_POOL_ABI,
        functionName: "supply",
        args: [cfg.weth, supplyWei, runner.address, 0],
      })
    );
  }

  txs.push(
    await writeAndWait(runner, chainId, {
      address: cfg.aavePool,
      abi: AAVE_POOL_ABI,
      functionName: "borrow",
      args: [cfg.usdc, borrowUnits, BigInt(VARIABLE_RATE_MODE), 0, runner.address],
    })
  );

  await ensureAllowance(runner, chainId, cfg.usdc, cfg.aavePool, maxUint256, txs);
  txs.push(
    await writeAndWait(runner, chainId, {
      address: cfg.aavePool,
      abi: AAVE_POOL_ABI,
      functionName: "repay",
      args: [cfg.usdc, maxUint256, BigInt(VARIABLE_RATE_MODE), runner.address],
    })
  );

  return { txCount: txs.length, txs, durationMs: Date.now() - started };
}

function morphoMarketParams(oracle: Address) {
  return {
    loanToken: BASE.usdc,
    collateralToken: BASE.weth,
    oracle,
    irm: BASE.morphoIrm,
    lltv: BASE.morphoLltv,
  } as const;
}

function morphoMarketId(params: ReturnType<typeof morphoMarketParams>) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]
    )
  );
}

async function runMorpho(runner: PrepRunner): Promise<PrepStepResult> {
  const started = Date.now();
  const chainId = await runner.ensureChain("base");
  const txs: Hash[] = [];
  const supplyWei = parseEther("0.001");
  const borrowUnits = parseUnits("0.1", 6);
  const minWei = parseEther("0.002");

  const ethBal = await runner.publicClient.getBalance({ address: runner.address });
  if (ethBal < minWei) throw new Error("Need at least 0.002 ETH on Base Sepolia");

  const oraclePrice = await runner.publicClient.readContract({
    address: BASE.morphoOracle,
    abi: MORPHO_ORACLE_ABI,
    functionName: "price",
  });
  if (oraclePrice === 0n) throw new Error("Morpho oracle unavailable on Base Sepolia");

  const params = morphoMarketParams(BASE.morphoOracle);
  const marketId = morphoMarketId(params);

  const market = await runner.publicClient.readContract({
    address: BASE.morpho,
    abi: MORPHO_ABI,
    functionName: "market",
    args: [marketId],
  });
  if (market[4] === 0n) {
    txs.push(
      await writeAndWait(runner, chainId, {
        address: BASE.morpho,
        abi: MORPHO_ABI,
        functionName: "createMarket",
        args: [params],
      })
    );
  }

  const wethBal = (await runner.publicClient.readContract({
    address: BASE.weth,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [runner.address],
  })) as bigint;

  if (wethBal < supplyWei) {
    txs.push(
      await writeAndWait(runner, chainId, {
        address: BASE.weth,
        abi: WETH_ABI,
        functionName: "deposit",
        value: supplyWei - wethBal,
      })
    );
  }

  await ensureAllowance(runner, chainId, BASE.weth, BASE.morpho, supplyWei, txs);
  txs.push(
    await writeAndWait(runner, chainId, {
      address: BASE.morpho,
      abi: MORPHO_ABI,
      functionName: "supplyCollateral",
      args: [params, supplyWei, runner.address, "0x"],
    })
  );

  const mkt = await runner.publicClient.readContract({
    address: BASE.morpho,
    abi: MORPHO_ABI,
    functionName: "market",
    args: [marketId],
  });
  const available =
    mkt[0] >= mkt[2] ? mkt[0] - mkt[2] : 0n;
  if (available < borrowUnits) {
    const seedAmt = parseUnits("1", 6) > (borrowUnits * 110n) / 100n
      ? parseUnits("1", 6)
      : (borrowUnits * 110n) / 100n;
    const usdcBal = (await runner.publicClient.readContract({
      address: BASE.usdc,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [runner.address],
    })) as bigint;
    if (usdcBal < seedAmt) {
      throw new Error("Not enough USDC to seed Morpho liquidity — get testnet USDC first");
    }
    await ensureAllowance(runner, chainId, BASE.usdc, BASE.morpho, seedAmt, txs);
    txs.push(
      await writeAndWait(runner, chainId, {
        address: BASE.morpho,
        abi: MORPHO_ABI,
        functionName: "supply",
        args: [params, seedAmt, 0n, runner.address, "0x"],
      })
    );
  }

  txs.push(
    await writeAndWait(runner, chainId, {
      address: BASE.morpho,
      abi: MORPHO_ABI,
      functionName: "borrow",
      args: [params, borrowUnits, 0n, runner.address, runner.address],
    })
  );

  await ensureAllowance(runner, chainId, BASE.usdc, BASE.morpho, maxUint256, txs);
  const pos = await runner.publicClient.readContract({
    address: BASE.morpho,
    abi: MORPHO_ABI,
    functionName: "position",
    args: [marketId, runner.address],
  });
  if (pos[1] > 0n) {
    txs.push(
      await writeAndWait(runner, chainId, {
        address: BASE.morpho,
        abi: MORPHO_ABI,
        functionName: "repay",
        args: [params, 0n, pos[1], runner.address, "0x"],
      })
    );
  }

  const posAfter = await runner.publicClient.readContract({
    address: BASE.morpho,
    abi: MORPHO_ABI,
    functionName: "position",
    args: [marketId, runner.address],
  });
  if (posAfter[2] > 0n) {
    txs.push(
      await writeAndWait(runner, chainId, {
        address: BASE.morpho,
        abi: MORPHO_ABI,
        functionName: "withdrawCollateral",
        args: [params, BigInt(posAfter[2]), runner.address, runner.address],
      })
    );
  }

  return { txCount: txs.length, txs, durationMs: Date.now() - started };
}

export async function runPrepWalletStep(
  stepId: PrepWalletStepId,
  runner: PrepRunner
): Promise<PrepStepResult> {
  switch (stepId) {
    case "arbitrum-activity":
      return runActivity(runner, "arbitrum", ARBITRUM.weth);
    case "base-activity":
      return runActivity(runner, "base", BASE.weth);
    case "arbitrum-aave":
      return runAave(runner, "arbitrum", ARBITRUM);
    case "base-aave":
      return runAave(runner, "base", BASE);
    case "morpho":
      return runMorpho(runner);
    default:
      throw new Error(`Unknown prep step: ${stepId}`);
  }
}

export function prepStepChainId(network: "arbitrum" | "base"): number {
  return chainIdByKey[chainKeyForNetwork(network)];
}
