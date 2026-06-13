"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";
import { AppToaster } from "@/components/ui/AppToaster";
import { wagmiConfig } from "@/lib/wagmi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "oklch(0.9247 0.0524 66.1732)",
            accentColorForeground: "oklch(0.2029 0.024 200.1962)",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          {children}
          <AppToaster />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
