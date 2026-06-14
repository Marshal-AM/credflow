"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChainSummary, LoanEvent } from "./loans-types";
import { readBorrowChain, STORAGE_KEYS, writeStorage } from "@/lib/ui-persistence";

type LoansChainContextValue = {
  chains: ChainSummary[];
  loanEvents: LoanEvent[];
  displayCredScore: number | null;
  selectedChainKey: string | null;
  setSelectedChainKey: (chainKey: string | null) => void;
  selectedChain: ChainSummary | null;
  chainOptions: { chainKey: string; label: string }[];
  reload: () => Promise<void>;
};

const LoansChainContext = createContext<LoansChainContextValue | null>(null);

export function LoansChainProvider({
  chains,
  loanEvents,
  displayCredScore,
  reload,
  children,
}: {
  chains: ChainSummary[];
  loanEvents: LoanEvent[];
  displayCredScore: number | null;
  reload: () => Promise<void>;
  children: ReactNode;
}) {
  const [selectedChainKey, setSelectedChainKeyState] = useState<string | null>(null);

  useLayoutEffect(() => {
    const saved = readBorrowChain();
    if (saved) setSelectedChainKeyState(saved);
  }, []);

  const setSelectedChainKey = useCallback((chainKey: string | null) => {
    setSelectedChainKeyState(chainKey);
    if (chainKey) writeStorage(STORAGE_KEYS.borrowChain, chainKey);
  }, []);

  const chainOptions = useMemo(
    () => chains.map((c) => ({ chainKey: c.chainKey, label: c.label })),
    [chains]
  );

  const selectedChain = useMemo(
    () => chains.find((c) => c.chainKey === selectedChainKey) ?? null,
    [chains, selectedChainKey]
  );

  useLayoutEffect(() => {
    if (chains.length === 0) return;
    if (selectedChainKey && chains.some((c) => c.chainKey === selectedChainKey)) return;
    setSelectedChainKeyState(null);
  }, [chains, selectedChainKey]);

  const value = useMemo(
    () => ({
      chains,
      loanEvents,
      displayCredScore,
      selectedChainKey,
      setSelectedChainKey,
      selectedChain,
      chainOptions,
      reload,
    }),
    [
      chains,
      loanEvents,
      displayCredScore,
      selectedChainKey,
      setSelectedChainKey,
      selectedChain,
      chainOptions,
      reload,
    ]
  );

  return (
    <LoansChainContext.Provider value={value}>{children}</LoansChainContext.Provider>
  );
}

export function useLoansChain(): LoansChainContextValue {
  const ctx = useContext(LoansChainContext);
  if (!ctx) {
    throw new Error("useLoansChain must be used within LoansChainProvider");
  }
  return ctx;
}
