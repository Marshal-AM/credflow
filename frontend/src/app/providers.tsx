"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";
import { arbitrumSepolia, baseSepolia, robinhoodTestnet } from "@/lib/chains";

const queryClient = new QueryClient();

export const wagmiConfig = getDefaultConfig({
  appName: "CredFlow",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "credflow-dev",
  chains: [robinhoodTestnet, arbitrumSepolia, baseSepolia],
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
