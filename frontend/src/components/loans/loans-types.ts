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

export type LoanEvent = {
  id: string;
  wallet_address: string;
  chain_key: string;
  loan_id: number | null;
  event_type: string;
  borrow_amount: string | null;
  collateral_amount: string | null;
  borrow_token: string | null;
  tx_hash: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
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
