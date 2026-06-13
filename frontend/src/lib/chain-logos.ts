import type { ChainKey } from "./chains";

const CHAIN_LOGOS: Record<ChainKey, string> = {
  hub: "/chains/robinhood.png",
  arbitrum: "/chains/arbitrum.png",
  base: "/chains/base.png",
};

export function chainLogoSrc(chainKey: string): string {
  return CHAIN_LOGOS[chainKey as ChainKey] ?? "/chains/ethereum.png";
}

export const COLLATERAL_SYMBOL = "WETH";
