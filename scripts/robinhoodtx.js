// ============================================================
//  Robinhood Chain Testnet — First Interaction Finder
//  Chain ID : 46630
//  Run      : node rh_first_interaction.js
// ============================================================

const API_KEY = "xxxxxxxxxxxxxxxxx";   // <-- paste your Alchemy key
const WALLET  = "xxxxxxxxxxxxxxxxxx";    // <-- paste your 0x address

// ── constants ───────────────────────────────────────────────
const RPC_URL  = `https://robinhood-testnet.g.alchemy.com/v2/${API_KEY}`;
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";

// ── helpers ─────────────────────────────────────────────────
async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC [${method}]: ${json.error.message}`);
  return json.result;
}

function fmt(label, value) {
  const pad = label.padEnd(22);
  console.log(`  \x1b[90m${pad}\x1b[0m ${value}`);
}

// ── main ────────────────────────────────────────────────────
async function main() {
  console.log("\n\x1b[1m Robinhood Chain Testnet — First Interaction\x1b[0m");
  console.log(`  Wallet   : ${WALLET}`);
  console.log(`  Chain ID : 46630\n`);
  console.log("  ─────────────────────────────────────────────────");

  // ── 1. Validate wallet ──────────────────────────────────
  if (!WALLET.startsWith("0x") || WALLET.length !== 42) {
    console.error("\x1b[31m  Error: Invalid wallet address.\x1b[0m\n");
    process.exit(1);
  }

  // ── 2. Fetch sent transfers (wallet as sender) ──────────
  process.stdout.write("\n  Scanning outgoing transactions");

  let outgoing = [];
  let pageKey;
  do {
    const result = await rpc("alchemy_getAssetTransfers", [{
      fromBlock:        "0x0",
      toBlock:          "latest",
      fromAddress:      WALLET,
      category:         ["external", "erc20", "erc721", "erc1155"],
      withMetadata:     true,
      excludeZeroValue: false,
      maxCount:         "0x3e8",
      order:            "asc",
      ...(pageKey ? { pageKey } : {}),
    }]);
    outgoing = outgoing.concat(result.transfers || []);
    pageKey  = result.pageKey;
    process.stdout.write(".");
  } while (pageKey);

  // ── 3. Fetch received transfers (wallet as receiver) ────
  process.stdout.write("\n  Scanning incoming transactions");

  let incoming = [];
  pageKey = undefined;
  do {
    const result = await rpc("alchemy_getAssetTransfers", [{
      fromBlock:        "0x0",
      toBlock:          "latest",
      toAddress:        WALLET,
      category:         ["external", "erc20", "erc721", "erc1155"],
      withMetadata:     true,
      excludeZeroValue: false,
      maxCount:         "0x3e8",
      order:            "asc",
      ...(pageKey ? { pageKey } : {}),
    }]);
    incoming = incoming.concat(result.transfers || []);
    pageKey  = result.pageKey;
    process.stdout.write(".");
  } while (pageKey);

  console.log("\n");

  const all = [...outgoing, ...incoming];

  if (all.length === 0) {
    console.log("  \x1b[33mNo transactions found for this wallet on Robinhood Chain Testnet.\x1b[0m\n");
    return;
  }

  // ── 4. Sort all by block number ascending → first tx ────
  all.sort((a, b) => {
    const blockA = parseInt(a.blockNum, 16);
    const blockB = parseInt(b.blockNum, 16);
    return blockA - blockB;
  });

  const first = all[0];

  // ── 5. Fetch full tx details for the first one ──────────
  const receipt = await rpc("eth_getTransactionReceipt", [first.hash]);
  const tx      = await rpc("eth_getTransactionByHash",  [first.hash]);

  // ── 6. Parse timestamp ──────────────────────────────────
  const block     = await rpc("eth_getBlockByNumber", [receipt?.blockNumber || first.blockNum, false]);
  const timestamp = block ? parseInt(block.timestamp, 16) : null;
  const date      = timestamp ? new Date(timestamp * 1000) : null;

  const direction = first.from?.toLowerCase() === WALLET.toLowerCase() ? "Sent" : "Received";
  const status    = receipt ? (receipt.status === "0x1" ? "\x1b[32mSuccess\x1b[0m" : "\x1b[31mFailed\x1b[0m") : "Unknown";

  // ── 7. Print results ────────────────────────────────────
  console.log("  \x1b[1mFirst interaction found\x1b[0m\n");

  fmt("Timestamp",    date ? date.toUTCString() : "—");
  fmt("Local time",   date ? date.toLocaleString() : "—");
  fmt("Block number", parseInt(first.blockNum, 16).toLocaleString());
  fmt("Tx hash",      first.hash);
  fmt("Direction",    direction);
  fmt("From",         first.from || tx?.from || "—");
  fmt("To",           first.to   || tx?.to   || "—");
  fmt("Asset",        first.asset || "ETH");
  fmt("Amount",       first.value != null ? `${parseFloat(first.value).toFixed(6)} ${first.asset || "ETH"}` : "—");
  fmt("Status",       status);
  fmt("Explorer",     `${EXPLORER}/tx/${first.hash}`);

  // ── 8. Summary stats ────────────────────────────────────
  console.log("\n  ─────────────────────────────────────────────────");
  console.log("  \x1b[1mWallet summary\x1b[0m\n");
  fmt("Total txns found",  all.length.toString());
  fmt("Outgoing txns",     outgoing.length.toString());
  fmt("Incoming txns",     incoming.length.toString());

  if (date) {
    const ageDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    fmt("Wallet age on chain", `${ageDays} day${ageDays !== 1 ? "s" : ""}`);
  }

  console.log(`\n  \x1b[90mView wallet: ${EXPLORER}/address/${WALLET}\x1b[0m\n`);
}

main().catch(e => {
  console.error("\n\x1b[31m Error:\x1b[0m", e.message);
  process.exit(1);
});