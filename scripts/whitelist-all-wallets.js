#!/usr/bin/env node
/**
 * Whitelist every wallet CredFlow has interacted with (Supabase + on-chain).
 * Reuses the same hub SBT whitelistWallet flow as unblacklist-wallet.js.
 *
 * Usage:
 *   node scripts/whitelist-all-wallets.js
 *   node scripts/whitelist-all-wallets.js --dry-run
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", "frontend", ".env") });

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");
const SUPABASE_TABLES = [
  "account_profiles",
  "score_runs",
  "loan_events",
  "layerzero_broadcasts",
  "agent_runs",
];

function supabaseHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function fetchSupabaseWallets(url, key) {
  const wallets = new Set();
  for (const table of SUPABASE_TABLES) {
    let offset = 0;
    const limit = 1000;
    while (true) {
      const res = await fetch(
        `${url}/rest/v1/${table}?select=wallet_address&wallet_address=not.is.null&limit=${limit}&offset=${offset}`,
        { headers: supabaseHeaders(key) }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${table}: ${res.status} ${body}`);
      }
      const rows = await res.json();
      for (const row of rows) {
        if (row.wallet_address) wallets.add(row.wallet_address.toLowerCase());
      }
      if (rows.length < limit) break;
      offset += limit;
    }
  }
  return wallets;
}

async function fetchOnChainWallets(sbt, lending) {
  const wallets = new Set();
  const mints = await sbt.queryFilter(sbt.filters.SBTMinted(), 0, "latest");
  for (const event of mints) {
    wallets.add(String(event.args.wallet).toLowerCase());
  }
  try {
    const loans = await lending.queryFilter(lending.filters.LoanCreated(), 0, "latest");
    for (const event of loans) {
      const borrower = event.args?.borrower ?? event.args?.[0];
      if (borrower) wallets.add(String(borrower).toLowerCase());
    }
  } catch (err) {
    console.warn("LoanCreated scan skipped:", err.message);
  }
  return wallets;
}

async function whitelistWallet(sbt, wallet) {
  const checksum = ethers.getAddress(wallet);
  const hasProfile = await sbt.hasProfile(checksum);
  const wasBlacklisted = await sbt.isBlacklisted(checksum);

  if (!hasProfile) {
    if (!wasBlacklisted) {
      return { wallet: checksum, status: "already_whitelisted", note: "no_profile" };
    }
    const tx = await sbt.removeFromBlacklist(checksum);
    await tx.wait();
    return {
      wallet: checksum,
      status: "whitelisted",
      action: "removeFromBlacklist",
      tx: tx.hash,
      wasBlacklisted: true,
      isBlacklisted: await sbt.isBlacklisted(checksum),
    };
  }

  const profile = await sbt.getProfile(checksum);
  const defaultCount = profile.defaultCount;

  if (!wasBlacklisted && defaultCount === 0n) {
    return { wallet: checksum, status: "already_whitelisted" };
  }

  const tx = await sbt.whitelistWallet(checksum);
  await tx.wait();
  return {
    wallet: checksum,
    status: "whitelisted",
    action: "whitelistWallet",
    tx: tx.hash,
    wasBlacklisted,
    defaultCountBefore: defaultCount.toString(),
    defaultCountAfter: (await sbt.getProfile(checksum)).defaultCount.toString(),
    isBlacklisted: await sbt.isBlacklisted(checksum),
  };
}

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.WHITELIST_DRY_RUN === "1";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const [agent] = await ethers.getSigners();
  const sbt = await ethers.getContractAt("CredScoreSBT", addresses.sbt);
  const lending = await ethers.getContractAt("CredFlowLending", addresses.lending);

  const agentRole = await sbt.AGENT_ROLE();
  if (!(await sbt.hasRole(agentRole, agent.address))) {
    throw new Error(`Agent ${agent.address} lacks AGENT_ROLE on SBT`);
  }

  const wallets = new Set();
  if (url && key) {
    const supabaseWallets = await fetchSupabaseWallets(url, key);
    for (const w of supabaseWallets) wallets.add(w);
    console.log(`Supabase wallets: ${supabaseWallets.size}`);
  } else {
    console.warn("Supabase not configured — using on-chain wallets only");
  }

  const onChainWallets = await fetchOnChainWallets(sbt, lending);
  for (const w of onChainWallets) wallets.add(w);
  console.log(`On-chain wallets: ${onChainWallets.size}`);
  console.log(`Total unique wallets: ${wallets.size}`);

  const sorted = [...wallets].sort();
  for (const wallet of sorted) {
    console.log(`  ${wallet}`);
  }

  if (dryRun) {
    console.log("\nDRY RUN — no on-chain transactions sent.");
    return;
  }

  console.log("\nWhitelisting on hub SBT:", addresses.sbt);
  console.log("Agent:", agent.address);

  const results = [];
  for (const wallet of sorted) {
    try {
      const result = await whitelistWallet(sbt, wallet);
      results.push(result);
      console.log(
        `${result.wallet}: ${result.status}` +
          (result.tx ? ` tx=${result.tx}` : "")
      );
    } catch (err) {
      results.push({ wallet, status: "error", error: err.message || String(err) });
      console.error(`${wallet}: ERROR ${err.message || err}`);
    }
  }

  const changed = results.filter((r) => r.status === "whitelisted").length;
  const skipped = results.filter((r) => r.status === "already_whitelisted").length;
  const failed = results.filter((r) => r.status === "error").length;
  console.log(`\nDone. whitelisted=${changed} already_ok=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
