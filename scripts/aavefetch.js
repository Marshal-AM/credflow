// ============================================================
//  Aave V3 Base Sepolia — Activity Fetcher
//  Run: node aave_activity.js
// ============================================================

const API_KEY  = process.env.ALCHEMY_API_KEY || "c5Zu5NC-feTdpw7zIq0eX";
const WALLET   = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844";    // <-- paste your 0x address

// ── constants ───────────────────────────────────────────────
const RPC_URL   = `https://base-sepolia.g.alchemy.com/v2/${API_KEY}`;
const AAVE_POOL = "0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27";
const BASESCAN  = "https://sepolia.basescan.org/tx/";

// Aave V3 event topic → action name
const EVENT_TOPICS = {
  "0xde6857219544bb5b7746f48ed30be6386fefc61ebafb8a5e7e5a0cf22b025b5e": "Supply",
  "0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7": "Withdraw",
  "0xb3d084820fb1a9decffb176436bd02b9f48dd2df1bd1977aa3d02e9d0a5b2e46": "Borrow",
  "0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa": "Repay",
  "0x44c58d81365b66dd4b1a7f36c25aa97b8c71c361ee4937adc1a00000227db5dd": "FlashLoan",
  "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286": "Liquidation",
};

// Function selectors as fallback
const SELECTORS = {
  "0x617ba037": "Supply",
  "0x69328dec": "Withdraw",
  "0xa415bcad": "Borrow",
  "0x573ade81": "Repay",
  "0xab9c4b5d": "FlashLoan",
  "0x00a718a9": "Liquidation",
};

// Known assets on Base Sepolia
const ASSETS = {
  "0x4200000000000000000000000000000000000006": { symbol: "WETH",  decimals: 18 },
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC",  decimals: 6  },
  "0x29f2d40b0605204364af54ec677bd022da425d03": { symbol: "WBTC",  decimals: 8  },
  "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582": { symbol: "LINK",  decimals: 18 },
  "0x7b79995e5f793a07bc00c21412e50ecae098e7f9": { symbol: "WETH",  decimals: 18 },
};

// ── helpers ─────────────────────────────────────────────────
async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error [${method}]: ${json.error.message}`);
  return json.result;
}

function decodeAmount(data, decimals = 18) {
  try {
    if (!data || data === "0x" || data.length < 66) return "—";
    const hex = data.slice(2, 66);
    const val = BigInt("0x" + hex);
    if (val === 0n) return "0";
    const d   = BigInt(10 ** Math.min(decimals, 18));
    const int = val / d;
    const frac = ((val % d) * 10000n / d).toString().padStart(4, "0");
    return frac === "0000" ? int.toString() : `${int}.${frac.replace(/0+$/, "")}`;
  } catch {
    return "—";
  }
}

function gasEth(gasUsed, gasPrice) {
  try {
    const wei = BigInt(gasUsed) * BigInt(gasPrice);
    return (Number(wei) / 1e18).toFixed(8);
  } catch {
    return "—";
  }
}

function actionFromLogs(logs) {
  for (const log of logs) {
    const topic = log.topics?.[0]?.toLowerCase();
    if (topic && EVENT_TOPICS[topic]) return EVENT_TOPICS[topic];
  }
  return null;
}

function actionFromInput(input) {
  if (!input || input.length < 10) return "Unknown";
  return SELECTORS[input.slice(0, 10).toLowerCase()] || "Unknown";
}

function assetFromLog(log) {
  return ASSETS[log?.address?.toLowerCase()] || { symbol: log?.address?.slice(0, 8) + "…", decimals: 18 };
}

function colorBadge(action) {
  const colors = {
    Supply:      "\x1b[32m",   // green
    Withdraw:    "\x1b[34m",   // blue
    Borrow:      "\x1b[33m",   // yellow
    Repay:       "\x1b[36m",   // cyan
    FlashLoan:   "\x1b[35m",   // magenta
    Liquidation: "\x1b[31m",   // red
    Unknown:     "\x1b[90m",   // gray
  };
  const reset = "\x1b[0m";
  return `${colors[action] || colors.Unknown}${action.padEnd(11)}${reset}`;
}

function printRow(row) {
  const date   = row.ts ? new Date(row.ts).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";
  const asset  = row.asset.padEnd(6);
  const amount = row.amount.padStart(14);
  const gas    = row.gas.padStart(12);
  const hash   = `${row.hash.slice(0, 10)}…`;
  console.log(`  ${date.padEnd(14)}  ${colorBadge(row.action)}  ${asset}  ${amount}  ${gas} ETH  ${hash}`);
}

// ── main ────────────────────────────────────────────────────
async function main() {
  console.log("\n\x1b[1m Aave V3 — Base Sepolia Activity\x1b[0m");
  console.log(` Wallet : ${WALLET}`);
  console.log(` Pool   : ${AAVE_POOL}`);
  console.log(" ─────────────────────────────────────────────────────────────────────\n");

  // 1. Fetch all transfers to the Aave pool from this wallet
  let transfers = [];
  let pageKey;
  process.stdout.write(" Fetching transactions");
  do {
    const result = await rpc("alchemy_getAssetTransfers", [{
      fromBlock:       "0x0",
      toBlock:         "latest",
      fromAddress:     WALLET,
      toAddress:       AAVE_POOL,
      category:        ["external"],
      withMetadata:    true,
      excludeZeroValue: false,
      maxCount:        "0x3e8",
      ...(pageKey ? { pageKey } : {}),
    }]);
    transfers = transfers.concat(result.transfers || []);
    pageKey   = result.pageKey;
    process.stdout.write(".");
  } while (pageKey);
  console.log(` ${transfers.length} found\n`);

  if (transfers.length === 0) {
    console.log(" No Aave activity found for this wallet.\n");
    return;
  }

  // 2. Deduplicate by tx hash
  const hashes = [...new Set(transfers.map(t => t.hash))];

  // 3. Fetch receipts + tx details in batches of 10
  process.stdout.write(" Loading tx details");
  const BATCH = 10;
  const receiptMap = {};
  const txMap = {};

  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH);
    await Promise.all(batch.map(async h => {
      const [receipt, tx] = await Promise.all([
        rpc("eth_getTransactionReceipt", [h]),
        rpc("eth_getTransactionByHash",  [h]),
      ]);
      receiptMap[h] = receipt;
      txMap[h]      = tx;
    }));
    process.stdout.write(".");
  }
  console.log(" done\n");

  // 4. Parse each tx
  const rows = hashes.map(hash => {
    const transfer = transfers.find(t => t.hash === hash);
    const receipt  = receiptMap[hash];
    const tx       = txMap[hash];
    const logs     = (receipt?.logs || []).filter(l => l.address?.toLowerCase() === AAVE_POOL);

    const action  = actionFromLogs(logs) || actionFromInput(tx?.input);
    const topLog  = logs[0];
    const asset   = topLog ? assetFromLog(topLog) : { symbol: transfer?.asset || "—", decimals: 18 };
    const amount  = topLog
      ? decodeAmount(topLog.data, asset.decimals)
      : (transfer?.value != null ? parseFloat(transfer.value).toFixed(6) : "—");
    const gas     = (receipt && tx) ? gasEth(receipt.gasUsed, tx.gasPrice) : "—";
    const ts      = transfer?.metadata?.blockTimestamp || null;
    const block   = receipt ? parseInt(receipt.blockNumber, 16) : 0;

    return { hash, action, asset: asset.symbol, amount, gas, ts, block };
  }).sort((a, b) => b.block - a.block);

  // 5. Print summary
  const counts = {};
  rows.forEach(r => { counts[r.action] = (counts[r.action] || 0) + 1; });
  console.log(" Summary:");
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`   ${colorBadge(k)} × ${v}`);
  });
  console.log();

  // 6. Print table
  console.log(`  ${"Date".padEnd(14)}  ${"Action".padEnd(11)}  ${"Asset".padEnd(6)}  ${"Amount".padStart(14)}  ${"Gas".padStart(12)}       Tx hash`);
  console.log("  " + "─".repeat(80));
  rows.forEach(printRow);

  console.log(`\n  Total: ${rows.length} transactions`);
  console.log(`  View on BaseScan: ${BASESCAN.replace("/tx/", "/address/")}${WALLET}\n`);
}

main().catch(e => {
  console.error("\n\x1b[31m Error:\x1b[0m", e.message);
  process.exit(1);
});