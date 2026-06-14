import { createConfig, http } from "wagmi";
import { arbitrumSepolia, baseSepolia, robinhoodTestnet } from "@/lib/chains";

export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet, arbitrumSepolia, baseSepolia] as never,
  transports: {
    [robinhoodTestnet.id]: http(robinhoodTestnet.rpcUrls.default.http[0]),
    [arbitrumSepolia.id]: http(arbitrumSepolia.rpcUrls.default.http[0]),
    [baseSepolia.id]: http(baseSepolia.rpcUrls.default.http[0]),
  },
  ssr: true,
});
