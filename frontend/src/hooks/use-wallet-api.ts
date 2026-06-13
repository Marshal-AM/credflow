"use client";

import { useCallback } from "react";
import { useAccount } from "wagmi";

export function useWalletApi() {
  const { address, isConnected, isConnecting } = useAccount();

  const apiFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!address) {
        throw new Error("Connect your wallet to continue");
      }
      const headers = new Headers(init?.headers);
      headers.set("x-wallet-address", address);
      return fetch(input, { ...init, headers });
    },
    [address]
  );

  return {
    address,
    isConnected,
    isConnecting,
    apiFetch,
  };
}
