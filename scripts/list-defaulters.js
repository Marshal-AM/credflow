const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", "frontend", ".env") });

const ROOT = path.join(__dirname, "..");

async function main() {
  const hub = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "addresses.json"), "utf8"));
  const arb = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "spoke-arbitrum-addresses.json"), "utf8"));
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "spoke-base-addresses.json"), "utf8"));

  const sbt = await ethers.getContractAt("CredScoreSBT", hub.sbt);
  const lending = await ethers.getContractAt("CredFlowLending", hub.lending);

  const defaults = await sbt.queryFilter(sbt.filters.DefaultRecorded(), 0, "latest");
  const blacklisted = await sbt.queryFilter(sbt.filters.WalletBlacklisted(), 0, "latest");

  const ringByDefaulter = new Map();
  for (const e of blacklisted) {
    const linkedTo = ethers.getAddress(e.args.linkedTo);
    if (linkedTo === ethers.ZeroAddress) continue;
    const victim = ethers.getAddress(e.args.wallet);
    const k = linkedTo.toLowerCase();
    if (!ringByDefaulter.has(k)) ringByDefaulter.set(k, new Set());
    ringByDefaulter.get(k).add(victim);
  }

  let liquidations = [];
  try {
    liquidations = await lending.queryFilter(lending.filters.LoanLiquidated(), 0, "latest");
  } catch {
    /* ABI may differ */
  }

  console.log("=== HUB CredScoreSBT DefaultRecorded ===");
  console.log("Contract:", hub.sbt);
  console.log("Events:", defaults.length);
  for (const e of defaults) {
    const w = ethers.getAddress(e.args.wallet);
    const hasProfile = await sbt.hasProfile(w);
    let defaultCount = "n/a";
    let isBl = await sbt.isBlacklisted(w);
    if (hasProfile) {
      const p = await sbt.getProfile(w);
      defaultCount = p.defaultCount.toString();
    }
    console.log(
      `  ${w} | defaultCount=${defaultCount} | blacklisted=${isBl} | block=${e.blockNumber} | tx=${e.transactionHash}`
    );
  }

  console.log("\n=== Defaulters from blacklistLinkedWallets (linkedTo) ===");
  const ringDefaulters = [...ringByDefaulter.keys()].map((k) => ethers.getAddress(k)).sort();
  console.log("Unique defaulters:", ringDefaulters.length);
  for (const d of ringDefaulters) {
    const ring = [...ringByDefaulter.get(d.toLowerCase())];
    const hasProfile = await sbt.hasProfile(d);
    let defaultCount = "n/a";
    if (hasProfile) {
      defaultCount = (await sbt.getProfile(d)).defaultCount.toString();
    }
    const isBl = await sbt.isBlacklisted(d);
    console.log(
      `  ${d} | ring_wallets=${ring.length} | defaultCount=${defaultCount} | blacklisted=${isBl}`
    );
  }

  console.log("\n=== Hub CredFlowLending LoanLiquidated ===");
  console.log("Contract:", hub.lending);
  console.log("Events:", liquidations.length);
  for (const e of liquidations) {
    const loanId = e.args?.loanId?.toString?.() ?? String(e.args?.[0] ?? "?");
    const borrower = e.args?.borrower
      ? ethers.getAddress(e.args.borrower)
      : e.args?.[1]
        ? ethers.getAddress(e.args[1])
        : "?";
    console.log(`  loanId=${loanId} borrower=${borrower} tx=${e.transactionHash}`);
  }

  const allKeys = new Set([
    ...defaults.map((e) => ethers.getAddress(e.args.wallet).toLowerCase()),
    ...ringDefaulters.map((d) => d.toLowerCase()),
    ...liquidations.map((e) => {
      const b = e.args?.borrower ?? e.args?.[1];
      return b ? ethers.getAddress(b).toLowerCase() : null;
    }).filter(Boolean),
  ]);

  console.log("\n=== Current hub SBT state (all known defaulters) ===");
  for (const k of [...allKeys].sort()) {
    const w = ethers.getAddress(k);
    const hasProfile = await sbt.hasProfile(w);
    const isBl = await sbt.isBlacklisted(w);
    let via = ethers.ZeroAddress;
    try {
      via = await sbt.blacklistedVia(w);
    } catch {
      /* ignore */
    }
    let defaultCount = 0n;
    let score = 0;
    if (hasProfile) {
      const p = await sbt.getProfile(w);
      defaultCount = p.defaultCount;
      score = Number(p.score);
    }
    const stillDefaulter = defaultCount > 0n || isBl;
    console.log(
      `  ${w} | STILL_DEFAULTER=${stillDefaulter} | defaultCount=${defaultCount} | blacklisted=${isBl} | blacklistedVia=${via} | score=${score}`
    );
  }

  const rpcArb =
    process.env.RPC_ARBITRUM_SEPOLIA || process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA;
  const rpcBase =
    process.env.RPC_BASE_SEPOLIA ||
    process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
    process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA;

  const scanWallets = new Set(allKeys);
  for (const victims of ringByDefaulter.values()) {
    for (const v of victims) scanWallets.add(v.toLowerCase());
  }

  console.log("\n=== Spoke OApp defaultBlacklist (event-known wallets) ===");
  for (const [chain, spoke, rpc] of [
    ["arbitrum", arb, rpcArb],
    ["base", base, rpcBase],
  ]) {
    if (!rpc) {
      console.log(`  ${chain}: RPC not configured`);
      continue;
    }
    const provider = new ethers.JsonRpcProvider(rpc);
    const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp, provider);
    const blocked = [];
    for (const k of scanWallets) {
      const w = ethers.getAddress(k);
      if (await oapp.isBlacklisted(w)) blocked.push(w);
    }
    console.log(`  ${chain} OApp ${spoke.oapp}: ${blocked.length} still blacklisted`);
    for (const w of blocked.sort()) console.log(`    ${w}`);
  }

  console.log("\n=== SUMMARY: distinct defaulter addresses ===");
  const sorted = [...allKeys].map((k) => ethers.getAddress(k)).sort();
  console.log("Total:", sorted.length);
  for (const w of sorted) console.log(w);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
