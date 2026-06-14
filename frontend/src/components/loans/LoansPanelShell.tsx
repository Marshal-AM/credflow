"use client";

import type { ReactNode } from "react";
import { ChainSelect } from "./ChainSelect";

type ChainOption = {
  chainKey: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  title: string;
  chainOptions: ChainOption[];
  selectedChainKey: string | null;
  onChainChange: (chainKey: string | null) => void;
  chainPlaceholder?: string;
  showChainSelect?: boolean;
  children: ReactNode;
};

export function LoansPanelShell({
  title,
  chainOptions,
  selectedChainKey,
  onChainChange,
  chainPlaceholder,
  showChainSelect = true,
  children,
}: Props) {
  return (
    <div className="card-padded space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-[650] tracking-tight">{title}</h2>
        {showChainSelect && chainOptions.length > 0 && (
          <ChainSelect
            options={chainOptions}
            value={selectedChainKey}
            onChange={onChainChange}
            placeholder={chainPlaceholder}
          />
        )}
      </div>
      {children}
    </div>
  );
}
