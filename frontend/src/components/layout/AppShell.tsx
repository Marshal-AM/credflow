"use client";

import { useState } from "react";
import { YourAccountTab } from "@/components/account/YourAccountTab";
import { LoansTab } from "@/components/loans/LoansTab";
import { AgentsTab } from "@/components/agents/AgentsTab";
import { TestDefaultTab } from "@/components/test-default/TestDefaultTab";
import { PrepWalletTab } from "@/components/prep-wallet/PrepWalletTab";
import { AppNavbar } from "./AppNavbar";

export type AppTab = "account" | "loans" | "agents" | "test-default" | "prep-wallet";

const TABS: { id: AppTab; label: string; subtitle: string }[] = [
  { id: "loans", label: "Loans", subtitle: "Borrow and repay across supported chains" },
  { id: "account", label: "Dashboard", subtitle: "Build your CredScore from wallet and bank data" },
  { id: "agents", label: "Agents", subtitle: "Background monitoring for your loans" },
  { id: "prep-wallet", label: "Prep Wallet", subtitle: "Seed testnet activity for your CredScore" },
  { id: "test-default", label: "Test Default", subtitle: "Liquidation and default scenario testing" },
];

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("loans");
  const active = TABS.find((t) => t.id === tab)!;
  const isDashboard = tab === "account";

  return (
    <div
      className={`bg-background select-none ${
        isDashboard ? "flex h-svh flex-col overflow-hidden" : "min-h-screen"
      }`}
    >
      <AppNavbar tab={tab} onTabChange={setTab} />
      <main
        className={`mx-auto flex w-full max-w-[var(--page-max)] flex-col px-[var(--page-gutter)] py-8 ${
          isDashboard ? "min-h-0 flex-1 overflow-hidden" : ""
        }`}
      >
        <div className="mb-8 shrink-0 animate-fade-in-up">
          <h1 className="page-title">{active.label}</h1>
          <p className="page-subtitle mt-1">{active.subtitle}</p>
        </div>
        <div
          className={`animate-fade-in-up stagger-2 ${
            isDashboard ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden" : ""
          }`}
        >
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
