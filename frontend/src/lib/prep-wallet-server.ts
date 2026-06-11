import { spawn } from "child_process";
import path from "path";
import { getFrontendAddress } from "@/lib/wallet-server";

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
  script: string;
  network: "arbitrumSepolia" | "baseSepolia";
  order: number;
};

export const PREP_WALLET_STEPS: PrepWalletStep[] = [
  {
    id: "arbitrum-activity",
    order: 1,
    label: "Arbitrum Sepolia transfers",
    description: "3 small ETH transfers + WETH deposit for protocol diversity",
    script: "scripts/arbitrum-sepolia-activity.js",
    network: "arbitrumSepolia",
  },
  {
    id: "base-activity",
    order: 2,
    label: "Base Sepolia transfers",
    description: "3 small ETH transfers + WETH deposit for protocol diversity",
    script: "scripts/base-sepolia-activity.js",
    network: "baseSepolia",
  },
  {
    id: "base-aave",
    order: 3,
    label: "Base Sepolia Aave",
    description: "Wrap ETH, supply WETH, borrow USDC, repay",
    script: "scripts/base-sepolia-aave.js",
    network: "baseSepolia",
  },
  {
    id: "arbitrum-aave",
    order: 4,
    label: "Arbitrum Sepolia Aave",
    description: "Wrap ETH, supply WETH, borrow USDC, repay",
    script: "scripts/arbitrum-sepolia-aave.js",
    network: "arbitrumSepolia",
  },
  {
    id: "morpho",
    order: 5,
    label: "Base Sepolia Morpho",
    description: "Supply WETH collateral, borrow USDC, repay, withdraw",
    script: "scripts/morpho.js",
    network: "baseSepolia",
  },
];

export type PrepWalletRunResult = {
  stepId: PrepWalletStepId;
  ok: boolean;
  stdout: string;
  stderr: string;
  txs: string[];
  txCount: number | null;
  durationMs: number;
  error?: string;
};

function getRepoRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith("frontend") || cwd.includes(`${path.sep}frontend`)) {
    return path.join(cwd, "..");
  }
  return cwd;
}

function extractTxHashes(output: string): string[] {
  const fromTxLines = [
    ...output.matchAll(/(?:^|\s)tx:\s*(0x[a-fA-F0-9]{64})/gm),
    ...output.matchAll(/\[(?:[^\]]+)\]\s*tx:\s*(0x[a-fA-F0-9]{64})/gm),
  ].map((m) => m[1]);
  if (fromTxLines.length) return [...new Set(fromTxLines)];
  const matches = output.match(/0x[a-fA-F0-9]{64}/g) ?? [];
  return [...new Set(matches)];
}

function extractTxCount(output: string): number | null {
  const match =
    output.match(/Broadcast\s+(\d+)\s+transaction/i) ||
    output.match(/Broadcast\s+(\d+)\s+tx/i);
  return match ? Number(match[1]) : null;
}

function resolvePrivateKey(): string {
  const pk = process.env.FRONTEND_PRIVATE_KEY;
  if (!pk) {
    throw new Error("FRONTEND_PRIVATE_KEY is not set in frontend/.env.local");
  }
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

export function getPrepWalletStatus() {
  const wallet = getFrontendAddress();
  return {
    wallet,
    steps: PREP_WALLET_STEPS.map(({ id, label, description, network, order }) => ({
      id,
      label,
      description,
      network,
      order,
    })),
  };
}

export async function runPrepWalletStep(stepId: PrepWalletStepId): Promise<PrepWalletRunResult> {
  const step = PREP_WALLET_STEPS.find((s) => s.id === stepId);
  if (!step) {
    throw new Error(`Unknown prep step: ${stepId}`);
  }

  const repoRoot = getRepoRoot();
  const privateKey = resolvePrivateKey();
  const wallet = getFrontendAddress();
  const started = Date.now();

  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const child = spawn(
      "npx",
      ["hardhat", "run", step.script, "--network", step.network],
      {
        cwd: repoRoot,
        shell: true,
        env: {
          ...process.env,
          DEPLOYER_PRIVATE_KEY: privateKey,
          AGENT_WALLET_ADDRESS: wallet,
          PREP_TX_DELAY_MS: process.env.PREP_TX_DELAY_MS || "10000",
          MORPHO_TX_DELAY_MS:
            process.env.MORPHO_TX_DELAY_MS || process.env.PREP_TX_DELAY_MS || "10000",
          MORPHO_LOG_CHUNK: process.env.MORPHO_LOG_CHUNK || "10",
          MORPHO_LOG_LOOKBACK: process.env.MORPHO_LOG_LOOKBACK || "500",
          BASE_SEPOLIA_AAVE_MIN_ETH: process.env.BASE_SEPOLIA_AAVE_MIN_ETH || "0.001",
          ARBITRUM_SEPOLIA_AAVE_MIN_ETH: process.env.ARBITRUM_SEPOLIA_AAVE_MIN_ETH || "0.001",
          MORPHO_ORACLE_ADDRESS:
            process.env.MORPHO_ORACLE_ADDRESS ||
            "0xc1b505f7ce2dc56abf5dc1495d6f66636937b125",
          MORPHO_MIN_ETH: process.env.MORPHO_MIN_ETH || "0.001",
        },
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });

  const combined = `${stdout}\n${stderr}`;
  const txs = extractTxHashes(combined);
  const txCount = extractTxCount(combined);
  const durationMs = Date.now() - started;

  if (exitCode !== 0) {
    const error =
      stderr.trim() ||
      stdout.split("\n").filter((line) => line.trim()).slice(-3).join(" ") ||
      `Script exited with code ${exitCode}`;
    return {
      stepId,
      ok: false,
      stdout,
      stderr,
      txs,
      txCount,
      durationMs,
      error,
    };
  }

  if (txCount === 0 && txs.length === 0) {
    return {
      stepId,
      ok: false,
      stdout,
      stderr,
      txs,
      txCount,
      durationMs,
      error: "Step finished without broadcasting any transactions",
    };
  }

  return {
    stepId,
    ok: true,
    stdout,
    stderr,
    txs,
    txCount,
    durationMs,
  };
}

export function isPrepWalletStepId(value: string): value is PrepWalletStepId {
  return PREP_WALLET_STEPS.some((s) => s.id === value);
}
