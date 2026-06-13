"use client";

import { useCallback } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import { chainIdByKey, type ChainKey } from "@/lib/chains";

export function useEnsureChain(chainKey: ChainKey) {
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const targetChainId = chainIdByKey[chainKey];

  const ensureChain = useCallback(async () => {
    if (chainId !== targetChainId) {
      await switchChainAsync({ chainId: targetChainId });
    }
  }, [chainId, switchChainAsync, targetChainId]);

  return {
    ensureChain,
    targetChainId,
    onCorrectChain: chainId === targetChainId,
  };
}
