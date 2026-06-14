#!/usr/bin/env node
/**
 * Delete all Supabase cache rows for one wallet (safe FK order).
 * Does not touch on-chain state.
 *
 * Usage:
 *   node scripts/wipe-wallet-supabase.js [wallet]
 *   WALLET=0x... node scripts/wipe-wallet-supabase.js
 *   node scripts/wipe-wallet-supabase.js --dry-run [wallet]
 */
const path = require("path");
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", "frontend", ".env") });

const DEFAULT_WALLET = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844";

/** Child tables first — agent_log_lines cascade when agent_runs is deleted. */
const TABLES = [
  "agent_runs",
  "layerzero_broadcasts",
  "loan_events",
  "score_runs",
  "account_profiles",
];

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const walletArg = argv.find((a) => a.startsWith("0x"));
  const wallet = (walletArg || process.env.WALLET || DEFAULT_WALLET).toLowerCase();
  return { dryRun, wallet };
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "count=exact",
    ...extra,
  };
}

async function countRows(url, key, table, wallet) {
  const res = await fetch(
    `${url}/rest/v1/${table}?wallet_address=eq.${encodeURIComponent(wallet)}&select=wallet_address`,
    { headers: supabaseHeaders(key, { Prefer: "count=exact" }) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${table} count: ${res.status} ${body}`);
  }
  const range = res.headers.get("content-range");
  if (!range) return 0;
  const m = range.match(/\/(\d+|\*)$/);
  return m && m[1] !== "*" ? Number(m[1]) : 0;
}

async function deleteRows(url, key, table, wallet) {
  const res = await fetch(
    `${url}/rest/v1/${table}?wallet_address=eq.${encodeURIComponent(wallet)}`,
    { method: "DELETE", headers: supabaseHeaders(key) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${table} delete: ${res.status} ${body}`);
  }
  const range = res.headers.get("content-range");
  if (!range) return 0;
  const m = range.match(/\/(\d+|\*)$/);
  return m && m[1] !== "*" ? Number(m[1]) : 0;
}

async function resetReclaim(wallet) {
  const base = process.env.SCORING_API_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${base}/reclaim/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: wallet, require_reclaim: false }),
    });
    if (!res.ok) return { ok: false, sessions_removed: 0 };
    const body = await res.json();
    return { ok: true, sessions_removed: Number(body.sessions_removed ?? 0) };
  } catch {
    return { ok: false, sessions_removed: 0 };
  }
}

async function main() {
  const { dryRun, wallet } = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  console.log(dryRun ? "DRY RUN — no deletes" : "Wiping Supabase rows");
  console.log("Wallet:", wallet);

  const before = {};
  for (const table of TABLES) {
    before[table] = await countRows(url, key, table, wallet);
    console.log(`  ${table}: ${before[table]} row(s)`);
  }

  const totalBefore = Object.values(before).reduce((a, b) => a + b, 0);
  if (totalBefore === 0) {
    console.log("Nothing to delete for this wallet.");
    return;
  }

  if (dryRun) {
    console.log("Would delete", totalBefore, "row(s) total.");
    return;
  }

  const deleted = {};
  for (const table of TABLES) {
    deleted[table] = before[table] > 0 ? await deleteRows(url, key, table, wallet) : 0;
  }

  const reclaim = await resetReclaim(wallet);

  console.log("\nDeleted:");
  for (const table of TABLES) {
    console.log(`  ${table}: ${deleted[table]}`);
  }
  if (reclaim.ok) {
    console.log(`  reclaim sessions: ${reclaim.sessions_removed}`);
  } else {
    console.log("  reclaim sessions: skipped (ML API offline)");
  }
  console.log("\nDone. On-chain state was not modified.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
