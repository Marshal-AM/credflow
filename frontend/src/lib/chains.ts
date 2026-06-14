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

/** Normalize tx hash for explorers (Robinhood expects 0x prefix). */
export function normalizeTxHash(hash: string): string {
  const trimmed = hash.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return `0x${trimmed.slice(2).toLowerCase()}`;
  }
  return `0x${trimmed.toLowerCase()}`;
}

/** Block explorer tx URL for a supported chain. */
export function txExplorerUrl(chainKey: ChainKey, txHash: string): string | null {
  const normalized = normalizeTxHash(txHash);
  if (!normalized.startsWith("0x") || normalized.length < 10) return null;
  switch (chainKey) {
    case "hub":
      return `${robinhoodExplorerBase}/tx/${normalized}`;
    case "arbitrum":
      return `https://sepolia.arbiscan.io/tx/${normalized}`;
    case "base":
      return `https://sepolia.basescan.org/tx/${normalized}`;
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
