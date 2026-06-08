import { createConfig, http } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";

const robinhoodChain = {
  id: Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID || 46630),
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_ROBINHOOD || "https://rpc.testnet.chain.robinhood.com"],
    },
  },
} as const;

export const config = createConfig({
  chains: [robinhoodChain],
  connectors: [injected(), metaMask()],
  transports: {
    [robinhoodChain.id]: http(),
  },
});
