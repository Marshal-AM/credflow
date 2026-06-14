import { formatEther, formatUnits } from "viem";
import { getPublicClient, readChainLoanSummary } from "@/lib/loan-server";
import { contractsByChain, LENDING_ABI, OAPP_ABI, SBT_ABI } from "@/lib/contracts";
import { isHubWalletBlacklisted } from "@/lib/wallet-blacklist";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  parseLiquidationSnapshot,
  type LiquidationSnapshot,
} from "@/lib/test-default/liquidation-snapshot";

export type { LiquidationSnapshot };

export type DefaultTestStatus = {
  wallet: string;
  hub: {
    loanId: string | null;
    loanActive: boolean;
    borrowed: string | null;
    collateralEth: string | null;
    dueTime: string | null;
    overdue: boolean;
    ltvBps: number | null;
    liquidationThresholdBps: number;
    score: number;
    defaultCount: number;
    hubBlacklisted: boolean;
  };
  spokes: Array<{
    chainKey: string;
    label: string;
    score: number;
    lzBlacklisted: boolean;
    lzLoanActive: boolean;
  }>;
  ready: {
    hasActiveLoan: boolean;
    liquidatable: boolean;
  };
  liquidationSnapshot: LiquidationSnapshot | null;
};

async function readLiquidationSnapshot(
  wallet: string
): Promise<LiquidationSnapshot | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("account_profiles")
    .select("liquidation_snapshot")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();

  if (error || !data) return null;
  return parseLiquidationSnapshot(data.liquidation_snapshot);
}

export async function readDefaultTestStatus(wallet: `0x${string}`): Promise<DefaultTestStatus> {
  const hubSummary = await readChainLoanSummary("hub", wallet);
  const client = getPublicClient("hub");
  const cfg = contractsByChain.hub;

  let ltvBps: number | null = null;
  let liquidationThresholdBps = 8500;
  let dueTime: string | null = null;
  let overdue = false;

  if (cfg.lending) {
    liquidationThresholdBps = Number(
      await client.readContract({
        address: cfg.lending as `0x${string}`,
        abi: LENDING_ABI,
        functionName: "liquidationThreshold",
      })
    );
  }

  const loanId = hubSummary.activeLoanId > 0n ? hubSummary.activeLoanId : null;
  if (loanId && cfg.lending) {
    ltvBps = Number(
      await client.readContract({
        address: cfg.lending as `0x${string}`,
        abi: LENDING_ABI,
        functionName: "getCurrentLTV",
        args: [loanId],
      })
    );
    if (hubSummary.loan) {
      dueTime = new Date(Number(hubSummary.loan.dueTime) * 1000).toISOString();
      overdue = Date.now() / 1000 > Number(hubSummary.loan.dueTime);
    }
  }

  const profile = cfg.sbt
    ? await client.readContract({
        address: cfg.sbt as `0x${string}`,
        abi: SBT_ABI,
        functionName: "getProfile",
        args: [wallet],
      })
    : null;

  const hubExplicitBlacklisted = cfg.sbt
    ? await client.readContract({
        address: cfg.sbt as `0x${string}`,
        abi: SBT_ABI,
        functionName: "isBlacklisted",
        args: [wallet],
      })
    : false;

  const hubBlacklisted = isHubWalletBlacklisted(
    profile ? profile.defaultCount : 0n,
    hubExplicitBlacklisted
  );

  const [spokes, liquidationSnapshot] = await Promise.all([
    Promise.all(
    (["arbitrum", "base"] as const).map(async (chainKey) => {
      const spoke = await readChainLoanSummary(chainKey, wallet);
      const spokeCfg = contractsByChain[chainKey];
      let lzBlacklisted = false;
      if (spokeCfg.oapp) {
        lzBlacklisted = await getPublicClient(chainKey).readContract({
          address: spokeCfg.oapp as `0x${string}`,
          abi: OAPP_ABI,
          functionName: "isBlacklisted",
          args: [wallet],
        });
      }
      return {
        chainKey,
        label: spoke.label,
        score: spoke.score,
        lzBlacklisted,
        lzLoanActive: spoke.lzLoanActive,
      };
    })
    ),
    hubBlacklisted ? readLiquidationSnapshot(wallet) : Promise.resolve(null),
  ]);

  return {
    wallet,
    hub: {
      loanId: loanId?.toString() ?? null,
      loanActive: Boolean(hubSummary.loan?.active),
      borrowed: hubSummary.loan
        ? formatUnits(hubSummary.loan.borrowedAmount, 6)
        : null,
      collateralEth: hubSummary.loan
        ? formatEther(hubSummary.loan.collateralAmount)
        : null,
      dueTime,
      overdue,
      ltvBps,
      liquidationThresholdBps,
      score: profile ? Number(profile.score) : hubSummary.score,
      defaultCount: profile ? Number(profile.defaultCount) : 0,
      hubBlacklisted,
    },
    spokes,
    ready: {
      hasActiveLoan: Boolean(loanId && hubSummary.loan?.active),
      liquidatable: ltvBps != null && ltvBps >= liquidationThresholdBps,
    },
    liquidationSnapshot,
  };
}
