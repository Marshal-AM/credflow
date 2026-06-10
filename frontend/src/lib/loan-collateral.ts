/** Collateral math — mirrors CredFlowLending.requestLoan LTV check (6-decimal USD). */

import { parseEther, parseUnits } from "viem";

/** Extra headroom so rounding / oracle drift does not revert at max LTV. */
export const COLLATERAL_BUFFER_BPS = 10100; // +1%

/**
 * Minimum WETH (wei) to post for a borrow at the wallet's score-tier max LTV.
 *
 * Contract: maxBorrow = collateralValueUSD * maxLTV / 10000
 * Inverse:   collateralValueUSD = borrowAmount * 10000 / maxLTV
 */
export function collateralWeiForBorrow(params: {
  borrowAmount: string;
  maxLtvBps: bigint | number;
  ethUsd6: bigint;
  bufferBps?: number;
}): bigint {
  const maxLtv = BigInt(params.maxLtvBps);
  if (maxLtv <= 0n) {
    throw new Error("Score too low — no LTV tier");
  }
  const borrow = parseUnits(params.borrowAmount, 6);
  if (borrow <= 0n) {
    throw new Error("Borrow amount must be positive");
  }
  const ethUsd6 = params.ethUsd6;
  if (ethUsd6 <= 0n) {
    throw new Error("ETH price unavailable");
  }

  const collateralValueUsd = (borrow * 10000n) / maxLtv;
  const oneEth = parseEther("1");
  let wei = (collateralValueUsd * oneEth + ethUsd6 - 1n) / ethUsd6;

  const buffer = params.bufferBps ?? COLLATERAL_BUFFER_BPS;
  wei = (wei * BigInt(buffer)) / 10000n;
  if (wei <= 0n) {
    wei = 1n;
  }
  return wei;
}

export function maxLtvPercent(maxLtvBps: number): string {
  return (maxLtvBps / 100).toFixed(0);
}
