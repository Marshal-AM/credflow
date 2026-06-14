"use client";

import Image from "next/image";
import { WalletSection } from "@/components/wallet/WalletSection";
import type { AppTab } from "@/lib/ui-persistence";

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M5 21V10M9 21V10M13 21V10M17 21V10" />
      <path d="m2 10 10-7 10 7" />
    </svg>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </svg>
  );
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

const NAV_PILL_1: { id: AppTab; label: string; icon: typeof UserIcon }[] = [
  { id: "account", label: "Dashboard", icon: UserIcon },
  { id: "loans", label: "Loans", icon: BankIcon },
];

const NAV_PILL_2: { id: AppTab; label: string; icon: typeof UserIcon }[] = [
  { id: "agents", label: "Agents", icon: BotIcon },
  { id: "prep-wallet", label: "Prep Wallet", icon: WrenchIcon },
  { id: "test-default", label: "Test Default", icon: FlaskIcon },
];

type Props = {
  tab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

export function AppNavbar({ tab, onTabChange }: Props) {
  return (
    <header className="shrink-0 bg-transparent pt-4 md:pt-6">
      <div className="flex h-[72px] w-full items-center justify-between bg-transparent px-[7.5%] transition-all duration-300">
        <div className="flex items-center gap-8 md:gap-10 lg:gap-12">
          <button
            type="button"
            onClick={() => onTabChange("account")}
            className="flex-shrink-0 transition-spring hover:scale-105"
            aria-label="Go to Dashboard"
          >
            <Image
              src="/logo.png"
              alt="CredFlow"
              width={120}
              height={40}
              className="h-9 w-auto md:h-10"
              priority
            />
          </button>

          <div className="flex items-center gap-4 md:gap-5">
            {[NAV_PILL_1, NAV_PILL_2].map((items, pillIndex) => (
              <div key={pillIndex} className="nav-pill">
                {items.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    onClick={() => onTabChange(id)}
                    className={`nav-pill-btn ${tab === id ? "active" : ""}`}
                  >
                    <Icon />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center">
          <WalletSection />
        </div>
      </div>
    </header>
  );
}
