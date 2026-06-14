"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { chainLogoSrc } from "@/lib/chain-logos";

type Option = {
  chainKey: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  options: Option[];
  value: string | null;
  onChange: (chainKey: string | null) => void;
  placeholder?: string;
  id?: string;
};

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChainLogo({ chainKey }: { chainKey: string; label: string }) {
  return (
    <Image
      src={chainLogoSrc(chainKey)}
      alt=""
      width={20}
      height={20}
      className="h-5 w-5 shrink-0 rounded-full object-cover"
      aria-hidden
    />
  );
}

export function ChainSelect({
  options,
  value,
  onChange,
  placeholder = "Select chain",
  id = "chain-select",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.chainKey === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-[220px]">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="input-field flex w-full min-w-[220px] cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {selected ? (
            <>
              <ChainLogo chainKey={selected.chainKey} label={selected.label} />
              <span className="truncate font-[650]">{selected.label}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-full min-w-[260px] overflow-hidden rounded-xl border border-border bg-card shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
        >
          {options.map(({ chainKey, label, disabled }) => {
            const isSelected = value === chainKey;
            return (
              <button
                key={chainKey}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                onClick={() => {
                  onChange(chainKey);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isSelected ? "bg-primary/10" : ""
                }`}
              >
                <ChainLogo chainKey={chainKey} label={label} />
                <span className="min-w-0 flex-1 truncate font-[650]">{label}</span>
                {isSelected && (
                  <svg
                    className="h-4 w-4 shrink-0 text-primary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BorrowChainPicker({
  options,
  onSelect,
}: {
  options: Option[];
  onSelect: (chainKey: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center sm:py-14">
      <h3 className="text-base font-[650] tracking-tight">Where would you like to borrow?</h3>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        Choose a chain to see your CredScore, collateral requirement, and loan terms.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {options.map(({ chainKey, label, disabled }) => (
          <button
            key={chainKey}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(chainKey)}
            className="surface-row flex min-w-[132px] flex-col items-center gap-2.5 px-5 py-4 transition-colors hover:border-primary/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Image
              src={chainLogoSrc(chainKey)}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-full object-cover"
              aria-hidden
            />
            <span className="text-sm font-[650]">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
