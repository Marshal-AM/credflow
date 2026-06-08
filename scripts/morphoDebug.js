/**
 * Debug: fetch Morpho Blue logs on Base Sepolia via Etherscan API V2.
 * Dumps raw logs and wallet-filtered event logs.
 *
 * Usage:
 *   npx hardhat run scripts/morphoDebug.js --network baseSepolia
 *
 * Env:
 *   WALLET=0x...
 *   BASESCAN_API_KEY or ETHERSCAN_API_KEY
 *   MORPHO_DEBUG_FROM_BLOCK=37000000
 */

require("dotenv").config();
const { Interface } = require("ethers");

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const CHAIN_ID = "84532";
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const WALLET = (process.env.WALLET || "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844").toLowerCase();
const API_KEY = process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";
const FROM_BLOCK = process.env.MORPHO_DEBUG_FROM_BLOCK || "37000000";
const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // Etherscan: page * offset <= 10000
const REQUEST_DELAY_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MORPHO_IFACE = new Interface([
  "event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)",
  "event WithdrawCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, address receiver, uint256 assets)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
]);

const EVENT_TOPICS = Object.fromEntries(
  ["SupplyCollateral", "WithdrawCollateral", "Borrow", "Repay"].map((name) => [
    name,
    MORPHO_IFACE.getEvent(name).topicHash,
  ])
);

async function etherscanGetLogs(params) {
  const qs = new URLSearchParams({
    chainid: CHAIN_ID,
    module: "logs",
    action: "getLogs",
    fromBlock: FROM_BLOCK,
    toBlock: "latest",
    apikey: API_KEY,
    ...params,
  });

  const res = await fetch(`${ETHERSCAN_V2}?${qs}`);
  await sleep(REQUEST_DELAY_MS);
  const json = await res.json();

  if (json.status !== "1") {
    const err = typeof json.result === "string" ? json.result : json.message;
    if (
      err === "No records found" ||
      json.message === "No records found" ||
      json.message === "No transactions found"
    ) {
      return [];
    }
    throw new Error(`Etherscan V2 getLogs failed: ${err || json.message || "unknown error"}`);
  }

  if (!Array.isArray(json.result)) {
    throw new Error(`Unexpected result type: ${typeof json.result}`);
  }

  return json.result;
}

async function fetchAllLogsSample() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await etherscanGetLogs({
      address: MORPHO_BLUE,
      page: String(page),
      offset: String(PAGE_SIZE),
    });
    all.push(...batch);
    console.log(`  page ${page}: ${batch.length} logs (total ${all.length})`);
    if (batch.length < PAGE_SIZE) {
      return { logs: all, truncated: false };
    }
  }
  return { logs: all, truncated: true };
}

async function fetchWalletFilteredLogs() {
  const walletTopic = "0x" + WALLET.slice(2).padStart(64, "0");
  const queries = [
    { event: "SupplyCollateral", topic: EVENT_TOPICS.SupplyCollateral, index: 1 },
    { event: "SupplyCollateral", topic: EVENT_TOPICS.SupplyCollateral, index: 2 },
    { event: "WithdrawCollateral", topic: EVENT_TOPICS.WithdrawCollateral, index: 1 },
    { event: "WithdrawCollateral", topic: EVENT_TOPICS.WithdrawCollateral, index: 2 },
    { event: "Borrow", topic: EVENT_TOPICS.Borrow, index: 2 },
    { event: "Borrow", topic: EVENT_TOPICS.Borrow, index: 3 },
    { event: "Repay", topic: EVENT_TOPICS.Repay, index: 1 },
    { event: "Repay", topic: EVENT_TOPICS.Repay, index: 2 },
  ];

  const seen = new Set();
  const rows = [];

  for (const { event, topic, index } of queries) {
    const topicKey = `topic${index}`;
    const logs = await etherscanGetLogs({
      address: MORPHO_BLUE,
      topic0: topic,
      [topicKey]: walletTopic,
      [`topic0_${index}_opr`]: "and",
      page: "1",
      offset: "1000",
    });

    for (const log of logs) {
      const key = `${log.transactionHash}-${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const parsed = MORPHO_IFACE.parseLog({ topics: log.topics, data: log.data });
        rows.push({ event, parsed, log });
      } catch {
        rows.push({ event, parsed: null, log });
      }
    }
  }

  rows.sort((a, b) => Number(a.log.blockNumber) - Number(b.log.blockNumber));
  return rows;
}

function logsMentionWallet(logs, walletHex) {
  return logs.filter(
    (log) =>
      (log.topics || []).some((t) => String(t).toLowerCase().includes(walletHex)) ||
      String(log.data || "").toLowerCase().includes(walletHex)
  );
}

async function main() {
  if (!API_KEY) {
    console.error("Set BASESCAN_API_KEY or ETHERSCAN_API_KEY in .env");
    process.exit(1);
  }

  console.log("Morpho Blue log debug — Base Sepolia (Etherscan API V2)");
  console.log(`Wallet:     ${WALLET}`);
  console.log(`Contract:   ${MORPHO_BLUE}`);
  console.log(`From block: ${FROM_BLOCK}\n`);

  console.log("1) Sample all Morpho logs (up to 10k API cap)...");
  const { logs, truncated } = await fetchAllLogsSample();
  console.log(`\nTotal sample logs: ${logs.length}${truncated ? " (truncated at 10k API limit)" : ""}`);

  const walletHex = WALLET.slice(2);
  const matching = logsMentionWallet(logs, walletHex);
  console.log(`Logs mentioning wallet in sample: ${matching.length}`);

  if (logs.length > 0) {
    console.log("\n--- First 3 raw logs ---");
    for (const log of logs.slice(0, 3)) {
      console.log({
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        topics: log.topics,
      });
    }
  }

  console.log("\n2) Wallet-filtered Morpho events (topic queries)...");
  const walletRows = await fetchWalletFilteredLogs();
  console.log(`Wallet event rows: ${walletRows.length}\n`);

  for (const { event, parsed, log } of walletRows) {
    const assets = parsed?.args?.assets?.toString?.() ?? "?";
    console.log(
      `[block ${Number(log.blockNumber)}] ${event.padEnd(20)} assets=${assets}  tx=${log.transactionHash}`
    );
  }

  if (walletRows.length === 0) {
    console.log("No wallet-filtered Morpho events found.");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
