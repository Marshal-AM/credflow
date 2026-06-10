"use client";

import { useState } from "react";
import { YourAccountTab } from "@/components/account/YourAccountTab";
import { PlaceholderTab } from "@/components/tabs/PlaceholderTab";

export type AppTab = "account" | "loans" | "agents" | "test-default";

const TABS: { id: AppTab; label: string }[] = [
  { id: "account", label: "Your Account" },
  { id: "loans", label: "Loans" },
  { id: "agents", label: "Agents" },
  { id: "test-default", label: "Test Default" },
];

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("account");

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-6 dark:border-zinc-800">
          <h1 className="text-lg font-bold tracking-tight">CredFlow</h1>
          <p className="text-xs text-zinc-500">Multi-chain credit</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                tab === id
                  ? "bg-emerald-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex flex-1 flex-col">
        <header className="border-b border-zinc-200 bg-white px-8 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">
            {TABS.find((t) => t.id === tab)?.label}
          </h2>
        </header>
        <div className="flex-1 overflow-auto p-8">
          {tab === "account" && <YourAccountTab />}
          {tab === "loans" && <PlaceholderTab title="Loans" />}
          {tab === "agents" && <PlaceholderTab title="Agents" />}
          {tab === "test-default" && <PlaceholderTab title="Test Default" />}
        </div>
      </main>
    </div>
  );
}
