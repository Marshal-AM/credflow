const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const SPOKE_KEYS = { arbitrum: "arbitrumSepolia", base: "baseSepolia" };

async function main() {
  const spokeArg = (process.env.SPOKE || "base").toLowerCase();
  const addrPath = path.join(__dirname, "..", "docs", `spoke-${spokeArg}-addresses.json`);
  let oappAddress = process.env[`${spokeArg.toUpperCase()}_OAPP_ADDRESS`];
  if (!oappAddress && fs.existsSync(addrPath)) {
    oappAddress = JSON.parse(fs.readFileSync(addrPath, "utf8")).oapp;
  }
  if (!oappAddress) throw new Error(`Missing OApp address for spoke ${spokeArg}`);

  const oapp = await ethers.getContractAt("CredFlowOApp", oappAddress);
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || (await ethers.getSigners())[0].address;
  const role = await oapp.AGENT_ROLE();
  const has = await oapp.hasRole(role, agentWallet);
  if (has) {
    console.log("AGENT_ROLE already granted to", agentWallet);
    return;
  }
  await (await oapp.grantRole(role, agentWallet)).wait();
  console.log("Granted AGENT_ROLE on", spokeArg, "to", agentWallet);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
