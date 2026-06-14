import { defineChain } from "viem";

const robinhoodExplorerBase =
  process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER ||
  "https://explorer.testnet.chain.robinhood.com";

export const robinhoodTestnet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID || 46630),
  name: "Robinhood Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_ROBINHOOD || "https://rpc.testnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: robinhoodExplorerBase },
  },
});

export const arbitrumSepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA ||
          "https://sepolia-rollup.arbitrum.io/rpc",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
  },
});

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA ||
          "https://sepolia.base.org",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
});

export const supportedChains = [robinhoodTestnet, arbitrumSepolia, baseSepolia] as const;

export type ChainKey = "hub" | "arbitrum" | "base";

export const chainKeyById: Record<number, ChainKey> = {
  [robinhoodTestnet.id]: "hub",
  [arbitrumSepolia.id]: "arbitrum",
  [baseSepolia.id]: "base",
};

export const chainIdByKey: Record<ChainKey, number> = {
  hub: robinhoodTestnet.id,
  arbitrum: arbitrumSepolia.id,
  base: baseSepolia.id,
};

/** Block explorer tx URL for a supported chain. */
export function txExplorerUrl(chainKey: ChainKey, txHash: string): string | null {
  switch (chainKey) {
    case "hub":
      return `${robinhoodExplorerBase}/tx/${txHash}`;
    case "arbitrum":
      return `https://sepolia.arbiscan.io/tx/${txHash}`;
    case "base":
      return `https://sepolia.basescan.org/tx/${txHash}`;
    default:
      return null;
  }
}

export function hubAddressExplorerUrl(address: string): string {
  return `${robinhoodExplorerBase}/address/${address}`;
}

/** ERC-721 NFT instance page on Robinhood Blockscout. */
export function hubNftExplorerUrl(contractAddress: string, tokenId: string | number): string {
  return `${robinhoodExplorerBase}/token/${contractAddress}/instance/${tokenId}`;
}
