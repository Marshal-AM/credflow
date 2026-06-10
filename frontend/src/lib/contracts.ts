import hubAddresses from "./addresses.json";
import arbitrumSpoke from "./spoke-arbitrum-addresses.json";
import baseSpoke from "./spoke-base-addresses.json";
import type { ChainKey } from "./chains";

export type ChainContracts = {
  chainId: number;
  label: string;
  sbt?: string;
  lending: string;
  oapp?: string;
  oracle?: string;
  borrowToken: string;
  borrowSymbol: string;
  weth: string;
  scoreSource: "sbt" | "oapp";
};

const hub: ChainContracts = {
  chainId: hubAddresses.chainId,
  label: "Robinhood Hub",
  sbt: hubAddresses.sbt,
  lending: hubAddresses.lending,
  oapp: hubAddresses.oapp,
  oracle: hubAddresses.oracle,
  borrowToken: hubAddresses.usdg,
  borrowSymbol: "USDG",
  weth: hubAddresses.weth,
  scoreSource: "sbt",
};

const arbitrum: ChainContracts = {
  chainId: arbitrumSpoke.chainId ?? 421614,
  label: "Arbitrum Sepolia",
  lending: arbitrumSpoke.lending || "",
  oapp: arbitrumSpoke.oapp,
  oracle: arbitrumSpoke.oracle,
  borrowToken: arbitrumSpoke.usdc || "",
  borrowSymbol: "USDC",
  weth: arbitrumSpoke.weth || "",
  scoreSource: "oapp",
};

const base: ChainContracts = {
  chainId: baseSpoke.chainId ?? 84532,
  label: "Base Sepolia",
  lending: baseSpoke.lending || "",
  oapp: baseSpoke.oapp,
  oracle: baseSpoke.oracle,
  borrowToken: baseSpoke.usdc || "",
  borrowSymbol: "USDC",
  weth: baseSpoke.weth || "",
  scoreSource: "oapp",
};

export const contractsByChain: Record<ChainKey, ChainContracts> = {
  hub,
  arbitrum,
  base,
};

export const SBT_ABI = [
  {
    name: "getProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "score", type: "uint16" },
          { name: "borrowSubScore", type: "uint16" },
          { name: "walletSubScore", type: "uint16" },
          { name: "loanStatus", type: "uint8" },
          { name: "totalLoans", type: "uint8" },
          { name: "defaultCount", type: "uint8" },
          { name: "lastUpdated", type: "uint32" },
          { name: "exists", type: "bool" },
          { name: "loanActive", type: "bool" },
          { name: "shapeExplanationCID", type: "string" },
        ],
      },
    ],
  },
  {
    name: "hasProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isBlacklisted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const OAPP_ABI = [
  {
    name: "getScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint16" }],
  },
  {
    name: "isBlacklisted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isLoanActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const LENDING_ABI = [
  {
    name: "requestLoan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrowAmount", type: "uint256" },
      { name: "collateralToken", type: "address" },
      { name: "collateralAmount", type: "uint256" },
      { name: "durationDays", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "borrowToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "getLTVForScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "score", type: "uint16" }],
    outputs: [{ type: "uint16" }],
  },
  {
    name: "activeLoanId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "loanCounter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "loans",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "borrower", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "collateralAmount", type: "uint256" },
          { name: "borrowedAmount", type: "uint256" },
          { name: "interestRate", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "dueTime", type: "uint256" },
          { name: "maxLTV", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "repayLoan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "LoanRepaid",
    type: "event",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "borrower", type: "address", indexed: true },
      { name: "totalRepaid", type: "uint256", indexed: false },
    ],
  },
  {
    name: "calculateInterest",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "loan",
        type: "tuple",
        components: [
          { name: "borrower", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "collateralAmount", type: "uint256" },
          { name: "borrowedAmount", type: "uint256" },
          { name: "interestRate", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "dueTime", type: "uint256" },
          { name: "maxLTV", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getRateForScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "score", type: "uint16" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getCurrentLTV",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "liquidationThreshold",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const WETH_ABI = [
  ...ERC20_ABI,
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

export const ORACLE_ABI = [
  {
    name: "getValueUSD",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
