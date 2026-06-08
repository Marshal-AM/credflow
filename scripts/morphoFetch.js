/**
 * Morpho Blue Wallet History — Base Sepolia
 * Uses Basescan API to fetch all event logs for a wallet on Morpho Blue.
 *
 * Usage:
 *   WALLET=0x2514... BASESCAN_API_KEY=your_key node scripts/morpho-history.js
 */

const MORPHO_BLUE    = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const BASESCAN_API   = "https://api-sepolia.basescan.org/api";
const WALLET         = process.env.WALLET;
const API_KEY        = process.env.BASESCAN_API_KEY || "";

if (!WALLET) { console.error("Set WALLET=0x..."); process.exit(1); }

const KNOWN_TOKENS = {
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals:  6 },
};

const { ethers } = require("ethers");
const { formatUnits, getAddress, Interface } = ethers;

const MORPHO_IFACE = new Interface([
  "event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)",
  "event WithdrawCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, address receiver, uint256 assets)",
  "event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Withdraw(bytes32 indexed id, address indexed caller, address indexed onBehalf, address receiver, uint256 assets, uint256 shares)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)",
]);

// Topic hashes for each event
const TOPICS = Object.fromEntries(
  ["SupplyCollateral","WithdrawCollateral","Supply","Withdraw","Borrow","Repay","Liquidate"]
    .map(name => [name, MORPHO_IFACE.getEvent(name).topicHash])
);

async function fetchLogs(topic, walletTopic, topicIndex) {
  // topicIndex: 1=caller, 2=onBehalf, 3=receiver/borrower
  const topicParams = { topic0: topic };
  topicParams[`topic${topicIndex}`] = walletTopic;
  topicParams[`topic0_${topicIndex}_opr`] = "and";

  const url = new URL(BASESCAN_API);
  url.search = new URLSearchParams({
    module:     "logs",
    action:     "getLogs",
    address:    MORPHO_BLUE,
    fromBlock:  "0",
    toBlock:    "latest",
    apikey:     API_KEY,
    ...topicParams,
  });

  const res  = await fetch(url.toString());
  const json = await res.json();
  return json.status === "1" ? json.result : [];
}

function tokenMeta(addr) {
  return addr ? (KNOWN_TOKENS[addr.toLowerCase()] || { symbol: addr.slice(0,8)+"…", decimals: 18 }) : { symbol: "?", decimals: 18 };
}

function fmt(hex, addr) {
  const { symbol, decimals } = tokenMeta(addr);
  return `${parseFloat(formatUnits(BigInt(hex), decimals)).toFixed(6)} ${symbol}`;
}

async function main() {
  const wallet      = WALLET.toLowerCase();
  const walletTopic = "0x" + wallet.slice(2).padStart(64, "0");

  console.log(`\nMorpho Blue History — Base Sepolia`);
  console.log(`Wallet: ${WALLET}\n`);

  // Fetch all relevant logs: each event × each position the wallet could appear
  const queries = [
    { name: "SupplyCollateral",   pos: 1 }, { name: "SupplyCollateral",   pos: 2 },
    { name: "WithdrawCollateral", pos: 1 }, { name: "WithdrawCollateral", pos: 2 },
    { name: "Supply",             pos: 1 }, { name: "Supply",             pos: 2 },
    { name: "Withdraw",           pos: 1 }, { name: "Withdraw",           pos: 2 },
    { name: "Borrow",             pos: 2 }, { name: "Borrow",             pos: 3 },
    { name: "Repay",              pos: 1 }, { name: "Repay",              pos: 2 },
    { name: "Liquidate",          pos: 1 }, { name: "Liquidate",          pos: 2 },
  ];

  const seen = new Set();
  const rows = [];

  for (const { name, pos } of queries) {
    const logs = await fetchLogs(TOPICS[name], walletTopic, pos);
    for (const log of logs) {
      const key = `${log.transactionHash}-${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const parsed = MORPHO_IFACE.parseLog({ topics: log.topics, data: log.data });
        rows.push({ name, parsed, log });
      } catch { /* skip */ }
    }
  }

  rows.sort((a, b) => Number(a.log.blockNumber) - Number(b.log.blockNumber));

  // We need market params to know token addresses — fetch CreateMarket for each unique id
  const marketIds = [...new Set(rows.map(r => r.parsed.args.id).filter(Boolean))];
  const markets   = {};

  const CREATE_MARKET_TOPIC = new Interface([
    "event CreateMarket(bytes32 indexed id, tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)"
  ]).getEvent("CreateMarket").topicHash;

  for (const id of marketIds) {
    const url = new URL(BASESCAN_API);
    url.search = new URLSearchParams({
      module: "logs", action: "getLogs",
      address: MORPHO_BLUE,
      fromBlock: "0", toBlock: "latest",
      topic0: CREATE_MARKET_TOPIC,
      topic1: id,
      topic0_1_opr: "and",
      apikey: API_KEY,
    });
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (json.status === "1" && json.result.length > 0) {
      try {
        const iface  = new Interface(["event CreateMarket(bytes32 indexed id, tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)"]);
        const parsed = iface.parseLog({ topics: json.result[0].topics, data: json.result[0].data });
        markets[id] = {
          loanToken:       parsed.args.marketParams.loanToken.toLowerCase(),
          collateralToken: parsed.args.marketParams.collateralToken.toLowerCase(),
          lltv:            parsed.args.marketParams.lltv,
        };
      } catch { /* skip */ }
    }
  }

  // Print
  console.log(`${"─".repeat(80)}`);
  console.log(`Found ${rows.length} event(s) across ${marketIds.length} market(s)\n`);

  for (const { name, parsed, log } of rows) {
    const id  = parsed.args.id;
    const mp  = id ? markets[id] : null;
    const loan = mp?.loanToken;
    const coll = mp?.collateralToken;
    const a    = parsed.args;

    let detail = "";
    switch (name) {
      case "SupplyCollateral":   detail = `+${fmt(a.assets, coll)} collateral`; break;
      case "WithdrawCollateral": detail = `-${fmt(a.assets, coll)} collateral`; break;
      case "Supply":             detail = `+${fmt(a.assets, loan)} liquidity`; break;
      case "Withdraw":           detail = `-${fmt(a.assets, loan)} liquidity`; break;
      case "Borrow":             detail = `BORROW ${fmt(a.assets, loan)}`; break;
      case "Repay":              detail = `REPAY  ${fmt(a.assets, loan)}`; break;
      case "Liquidate":          detail = `LIQUIDATE repaid=${fmt(a.repaidAssets, loan)} seized=${fmt(a.seizedAssets, coll)}`; break;
    }

    const collSymbol = coll ? tokenMeta(coll).symbol : "?";
    const loanSymbol = loan ? tokenMeta(loan).symbol : "?";
    const pair       = mp ? `${collSymbol}/${loanSymbol}` : "unknown market";

    console.log(`[block ${Number(log.blockNumber)}]  ${name.padEnd(20)}  ${pair.padEnd(10)}  ${detail}`);
    console.log(`  https://sepolia.basescan.org/tx/${log.transactionHash}\n`);
  }

  if (rows.length === 0) {
    console.log("No Morpho Blue activity found for this wallet.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });