const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");
const DEFAULT_WALLET = "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844";

async function main() {
  const [agent] = await ethers.getSigners();
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const wallet = process.env.UNBLACKLIST_WALLET || DEFAULT_WALLET;

  const sbt = await ethers.getContractAt("CredScoreSBT", addresses.sbt);
  const agentRole = await sbt.AGENT_ROLE();
  if (!(await sbt.hasRole(agentRole, agent.address))) {
    throw new Error(`Agent ${agent.address} lacks AGENT_ROLE on SBT`);
  }

  const wasBlacklisted = await sbt.isBlacklisted(wallet);
  console.log("SBT:", addresses.sbt);
  console.log("Wallet:", wallet);
  console.log("Was blacklisted:", wasBlacklisted);

  if (!wasBlacklisted) {
    console.log("Wallet is not blacklisted — nothing to do.");
    return;
  }

  const tx = await sbt.removeFromBlacklist(wallet);
  await tx.wait();
  console.log("removeFromBlacklist tx:", tx.hash);
  console.log("Is blacklisted now:", await sbt.isBlacklisted(wallet));
  console.log("Unblacklist complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
