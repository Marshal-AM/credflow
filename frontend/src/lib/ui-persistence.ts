export type AppTab = "account" | "loans" | "agents" | "test-default" | "prep-wallet";

const APP_TABS: AppTab[] = ["account", "loans", "agents", "prep-wallet", "test-default"];

export const STORAGE_KEYS = {
  tab: "credflow-tab",
  loansSubTab: "credflow-loans-subtab",
  borrowChain: "credflow-borrow-chain",
} as const;

export type LoanSubTab = "purchase" | "active" | "history";

const LOAN_SUB_TABS: LoanSubTab[] = ["purchase", "active", "history"];

export function isAppTab(value: string | null | undefined): value is AppTab {
  return !!value && (APP_TABS as string[]).includes(value);
}

export function isLoanSubTab(value: string | null | undefined): value is LoanSubTab {
  return !!value && (LOAN_SUB_TABS as string[]).includes(value);
}

export function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readAppTab(): AppTab {
  const saved = readStorage(STORAGE_KEYS.tab);
  return isAppTab(saved) ? saved : "account";
}

export function readLoanSubTab(): LoanSubTab {
  const saved = readStorage(STORAGE_KEYS.loansSubTab);
  if (saved === "repay") return "history";
  return isLoanSubTab(saved) ? saved : "purchase";
}

export function readBorrowChain(): string | null {
  return readStorage(STORAGE_KEYS.borrowChain);
}
