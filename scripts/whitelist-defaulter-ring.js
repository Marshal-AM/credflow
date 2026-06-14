#!/usr/bin/env node
/**
 * Find wallets blacklisted via a defaulter (0x251 ring) and clear them on-chain.
 *
 * Contracts:
 *   Hub CredScoreSBT  — blacklisted + blacklistedVia + profile.defaultCount
 *   Hub CredFlowOApp  — defaultBlacklist (LZ default mirror on hub)
 *   Spoke CredFlowOApp (arbitrum/base) — defaultBlacklist + spokeScores
 *
 * Usage:
 *   hardhat run scripts/whitelist-defaulter-ring.js --network robinhoodTestnet
 *   DEFULTER=0x2514... WHITELIST_DRY_RUN=1 hardhat run ...
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", "frontend", ".env") });

const ROOT = path.join(__dirname, "..");
const HUB_ADDRESSES = path.join(ROOT, "docs", "addresses.json");
const SPOKE_FILES = {
  arbitrum: path.join(ROOT, "docs", "spoke-arbitrum-addresses.json"),
  base: path.join(ROOT, "docs", "spoke-base-addresses.json"),
};
const DEFAULT_DEFULTER = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844";

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function findLinkedWallets(sbt, defaulter) {
  const linked = new Set();
  const events = await sbt.queryFilter(sbt.filters.WalletBlacklisted(), 0, "latest");
  const defaulterLower = defaulter.toLowerCase();
  for (const event of events) {
    const wallet = String(event.args.wallet).toLowerCase();
    const via = String(event.args.linkedTo).toLowerCase();
    if (via === defaulterLower) linked.add(wallet);
  }
  return linked;
}

async function hubSbtState(sbt, wallet) {
  const checksum = ethers.getAddress(wallet);
  const hasProfile = await sbt.hasProfile(checksum);
  let defaultCount = 0n;
  let score = 0;
  if (hasProfile) {
    const profile = await sbt.getProfile(checksum);
    defaultCount = profile.defaultCount;
    score = Number(profile.score);
  }
  const explicit = await sbt.isBlacklisted(checksum);
  let via = ethers.ZeroAddress;
  try {
    via = await sbt.blacklistedVia(checksum);
  } catch {
    /* older ABI */
  }
  return {
    wallet: checksum,
    hasProfile,
    score,
    explicitBlacklisted: explicit,
    blacklistedVia: via,
    defaultCount,
    hubBlocked: explicit || defaultCount > 0n,
  };
}

async function oappState(oapp, wallet) {
  const checksum = ethers.getAddress(wallet);
  const explicit = await oapp.isBlacklisted(checksum);
  let score = 0;
  try {
    score = Number(await oapp.getScore(checksum));
  } catch {
    /* hub oapp may differ */
  }
  return {
    wallet: checksum,
    explicitBlacklisted: explicit,
    score,
    spokeBlocked: explicit,
  };
}

async function clearHubSbt(sbt, wallet) {
  const checksum = ethers.getAddress(wallet);
  const state = await hubSbtState(sbt, checksum);
  if (!state.hubBlocked) {
    return { ...state, status: "already_ok", chain: "hub_sbt" };
  }
  if (!state.hasProfile) {
    if (!state.explicitBlacklisted) {
      return { ...state, status: "already_ok", chain: "hub_sbt" };
    }
    const tx = await sbt.removeFromBlacklist(checksum);
    await tx.wait();
    return { ...state, status: "cleared", action: "removeFromBlacklist", tx: tx.hash, chain: "hub_sbt" };
  }
  const tx = await sbt.whitelistWallet(checksum);
  await tx.wait();
  return { ...state, status: "cleared", action: "whitelistWallet", tx: tx.hash, chain: "hub_sbt" };
}

async function clearHubOapp(hubOapp, wallet, score) {
  const checksum = ethers.getAddress(wallet);
  const state = await oappState(hubOapp, checksum);
  if (!state.explicitBlacklisted) {
    return { ...state, status: "already_ok", chain: "hub_oapp" };
  }
  const tx = await hubOapp.clearDefaultBlacklist(checksum, score || state.score || 830);
  await tx.wait();
  return {
    ...state,
    status: "cleared",
    action: "clearDefaultBlacklist",
    tx: tx.hash,
    chain: "hub_oapp",
  };
}

async function clearSpokeOapp(chainKey, spokeAddresses, wallet, score) {
  const rpcEnv =
    chainKey === "arbitrum"
      ? process.env.RPC_ARBITRUM_SEPOLIA || process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA
      : process.env.RPC_BASE_SEPOLIA ||
        process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
        process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA;
  if (!rpcEnv) {
    return { chain: chainKey, status: "skipped", reason: "rpc_not_configured" };
  }

  const provider = new ethers.JsonRpcProvider(rpcEnv);
  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY or AGENT_PRIVATE_KEY required for spoke txs");
  const signer = new ethers.Wallet(pk, provider);

  const oapp = await ethers.getContractAt("CredFlowOApp", spokeAddresses.oapp, signer);
  const checksum = ethers.getAddress(wallet);
  const blocked = await oapp.isBlacklisted(checksum);
  let spokeScore = 0;
  try {
    spokeScore = Number(await oapp.getScore(checksum));
  } catch {
    /* ignore */
  }
  if (!blocked) {
    return {
      wallet: checksum,
      chain: chainKey,
      status: "already_ok",
      score: spokeScore,
      oapp: spokeAddresses.oapp,
    };
  }
  const tx = await oapp.clearDefaultBlacklist(checksum, score || spokeScore || 830);
  await tx.wait();
  return {
    wallet: checksum,
    chain: chainKey,
    status: "cleared",
    action: "clearDefaultBlacklist",
    tx: tx.hash,
    score: score || spokeScore || 830,
    oapp: spokeAddresses.oapp,
  };
}

async function broadcastSpokeWhitelist(hubOapp, wallet, score) {
  const addresses = loadJson(HUB_ADDRESSES);
  const arbitrum = loadJson(SPOKE_FILES.arbitrum);
  const base = loadJson(SPOKE_FILES.base);
  const eids = [arbitrum.eid, base.eid].filter(Boolean);
  const checksum = ethers.getAddress(wallet);
  const options = "0x";
  const feePerChain = ethers.parseEther("0.0005");
  const totalFee = feePerChain * BigInt(eids.length);
  const tx = await hubOapp.broadcastWhitelist(eids, checksum, score || 830, options, {
    value: totalFee,
  });
  await tx.wait();
  return { wallet: checksum, action: "broadcastWhitelist", tx: tx.hash, eids };
}

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.WHITELIST_DRY_RUN === "1";
  const defaulter = ethers.getAddress(
    process.env.DEFULTER || process.env.UNBLACKLIST_WALLET || DEFAULT_DEFULTER
  );

  const hub = loadJson(HUB_ADDRESSES);
  const [agent] = await ethers.getSigners();
  const sbt = await ethers.getContractAt("CredScoreSBT", hub.sbt);
  const hubOapp = await ethers.getContractAt("CredFlowOApp", hub.oapp);

  const agentRole = await sbt.AGENT_ROLE();
  if (!(await sbt.hasRole(agentRole, agent.address))) {
    throw new Error(`Agent ${agent.address} lacks AGENT_ROLE on hub SBT`);
  }

  console.log("Defaulter:", defaulter);
  console.log("Hub SBT:", hub.sbt);
  console.log("Hub OApp:", hub.oapp);
  console.log("Agent:", agent.address);

  const linked = await findLinkedWallets(sbt, defaulter);
  const targets = new Set([defaulter.toLowerCase(), ...linked]);
  targets.delete(ethers.ZeroAddress.toLowerCase());
  console.log(`\nLinked wallets (blacklistedVia=${defaulter}): ${linked.size}`);
  for (const w of [...linked].sort()) console.log(`  linked ${w}`);

  console.log("\n--- Blacklist scan ---");
  const scores = new Map();
  for (const wallet of [...targets].sort()) {
    const hubState = await hubSbtState(sbt, wallet);
    scores.set(wallet, hubState.score || 830);
    const hubOappState = await oappState(hubOapp, wallet);
    console.log(
      `${hubState.wallet}\n` +
        `  hub_sbt: explicit=${hubState.explicitBlacklisted} defaultCount=${hubState.defaultCount} via=${hubState.blacklistedVia}\n` +
        `  hub_oapp: blacklisted=${hubOappState.explicitBlacklisted} score=${hubOappState.score}`
    );
    for (const [chainKey, file] of Object.entries(SPOKE_FILES)) {
      const spoke = loadJson(file);
      const rpc =
        chainKey === "arbitrum"
          ? process.env.RPC_ARBITRUM_SEPOLIA || process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA
          : process.env.RPC_BASE_SEPOLIA ||
            process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
            process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA;
      if (!rpc) {
        console.log(`  ${chainKey}_oapp(${spoke.oapp}): rpc missing`);
        continue;
      }
      const provider = new ethers.JsonRpcProvider(rpc);
      const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp, provider);
      const spokeState = await oappState(oapp, wallet);
      console.log(
        `  ${chainKey}_oapp(${spoke.oapp}): blacklisted=${spokeState.explicitBlacklisted} score=${spokeState.score}`
      );
    }
  }

  if (dryRun) {
    console.log("\nDRY RUN — no transactions.");
    return;
  }

  console.log("\n--- Clearing blacklist state ---");
  for (const wallet of [...targets].sort()) {
    const score = scores.get(wallet) || 830;
    try {
      const hubResult = await clearHubSbt(sbt, wallet);
      console.log(`${wallet} hub_sbt: ${hubResult.status}${hubResult.tx ? ` tx=${hubResult.tx}` : ""}`);
    } catch (err) {
      console.error(`${wallet} hub_sbt ERROR:`, err.message || err);
    }

    try {
      const hubOappResult = await clearHubOapp(hubOapp, wallet, score);
      console.log(
        `${wallet} hub_oapp: ${hubOappResult.status}${hubOappResult.tx ? ` tx=${hubOappResult.tx}` : ""}`
      );
    } catch (err) {
      console.error(`${wallet} hub_oapp ERROR:`, err.message || err);
    }

    for (const [chainKey, file] of Object.entries(SPOKE_FILES)) {
      try {
        const spoke = loadJson(file);
        const result = await clearSpokeOapp(chainKey, spoke, wallet, score);
        console.log(
          `${wallet} ${chainKey}: ${result.status}${result.tx ? ` tx=${result.tx}` : ""}`
        );
      } catch (err) {
        console.error(`${wallet} ${chainKey} ERROR:`, err.message || err);
      }
    }

    try {
      const lz = await broadcastSpokeWhitelist(hubOapp, wallet, score);
      console.log(`${wallet} lz_whitelist: tx=${lz.tx}`);
    } catch (err) {
      console.warn(`${wallet} lz_whitelist skipped:`, err.message || err);
    }
  }

  console.log("\n--- Post-clear verification ---");
  for (const wallet of [...targets].sort()) {
    const hubState = await hubSbtState(sbt, wallet);
    const hubOappState = await oappState(hubOapp, wallet);
    let spokeFlags = [];
    for (const [chainKey, file] of Object.entries(SPOKE_FILES)) {
      const spoke = loadJson(file);
      const rpc =
        chainKey === "arbitrum"
          ? process.env.RPC_ARBITRUM_SEPOLIA || process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA
          : process.env.RPC_BASE_SEPOLIA ||
            process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
            process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA;
      if (!rpc) continue;
      const provider = new ethers.JsonRpcProvider(rpc);
      const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp, provider);
      const st = await oappState(oapp, wallet);
      spokeFlags.push(`${chainKey}=${st.explicitBlacklisted}`);
    }
    console.log(
      `${hubState.wallet}: hub_sbt_blocked=${hubState.hubBlocked} hub_oapp=${hubOappState.explicitBlacklisted} ${spokeFlags.join(" ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
