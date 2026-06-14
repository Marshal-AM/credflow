export type LoanData = {
  loanId: string;
  borrowedAmount: string;
  collateralAmount: string;
  interest: string;
  totalDue: string;
  dueTime: string;
  maxLTV: string;
  interestRate: string;
  active: boolean;
};

export type ChainSummary = {
  chainKey: string;
  label: string;
  score: number;
  eligible: boolean;
  eligibilityReason: string | null;
  loanActive: boolean;
  lzLoanActive?: boolean;
  lzLockKind?: "none" | "hub_mirror" | "lz_clear_pending";
  hasLocalLoan?: boolean;
  loan: LoanData | null;
};

export type CollateralQuote = {
  collateral_eth: string;
  max_ltv_pct: string;
  eth_usd: string;
};
