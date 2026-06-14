"use client";

import { useLayoutEffect, useState } from "react";
import { YourAccountTab } from "@/components/account/YourAccountTab";
import { LoansTab } from "@/components/loans/LoansTab";
import { AgentsTab } from "@/components/agents/AgentsTab";
import { TestDefaultTab } from "@/components/test-default/TestDefaultTab";
import { PrepWalletTab } from "@/components/prep-wallet/PrepWalletTab";
import { AppNavbar } from "./AppNavbar";
import { ScoreFlowGuardProvider, useScoreFlowGuard } from "@/contexts/ScoreFlowGuardContext";
import { readAppTab, STORAGE_KEYS, writeStorage, type AppTab } from "@/lib/ui-persistence";

export type { AppTab };

const TABS: { id: AppTab; label: string; subtitle: string }[] = [
  { id: "account", label: "Dashboard", subtitle: "Build your CredScore from wallet and bank data" },
  { id: "loans", label: "Loans", subtitle: "Borrow and repay across supported chains" },
  { id: "agents", label: "Agents", subtitle: "Background monitoring for your loans" },
  { id: "prep-wallet", label: "Prep Wallet", subtitle: "Seed testnet activity for your CredScore" },
  { id: "test-default", label: "Test Default", subtitle: "Liquidation and default scenario testing" },
];

function AppShellInner() {
  const [tab, setTab] = useState<AppTab>("account");
  const [ready, setReady] = useState(false);
  const { requestNavigation } = useScoreFlowGuard();

  useLayoutEffect(() => {
    setTab(readAppTab());
    setReady(true);
  }, []);

  function changeTab(next: AppTab) {
    if (next === tab) return;
    requestNavigation(() => {
      setTab(next);
      writeStorage(STORAGE_KEYS.tab, next);
    });
  }

  const active = TABS.find((t) => t.id === tab)!;

  if (!ready) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background select-none">
      <AppNavbar tab={tab} onTabChange={changeTab} />
      <main className="mx-auto flex w-full max-w-[var(--page-max)] flex-col px-[var(--page-gutter)] py-8">
        <div className="mb-8 shrink-0 animate-fade-in-up">
          <h1 className="page-title">{active.label}</h1>
          <p className="page-subtitle mt-1">{active.subtitle}</p>
        </div>
        <div className="animate-fade-in-up stagger-2">
          {tab === "account" && <YourAccountTab />}
          {tab === "loans" && <LoansTab />}
          {tab === "agents" && <AgentsTab />}
          {tab === "prep-wallet" && <PrepWalletTab />}
          {tab === "test-default" && <TestDefaultTab />}
        </div>
      </main>
    </div>
  );
}

export function AppShell() {
  return (
    <ScoreFlowGuardProvider>
      <AppShellInner />
    </ScoreFlowGuardProvider>
  );
}
