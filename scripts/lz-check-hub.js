const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const hub = process.env.HUB_OAPP_ADDRESS || (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")).oapp;
    } catch {
      return "";
    }
  })();
  const agent = process.env.AGENT_WALLET_ADDRESS;
  const oapp = await ethers.getContractAt("CredFlowOApp", hub);
  const role = await oapp.AGENT_ROLE();
  console.log("agent", agent);
  console.log("has AGENT_ROLE", await oapp.hasRole(role, agent));
  for (const eid of [40231, 40245]) {
    console.log("peer", eid, await oapp.peers(eid));
  }
}

main().catch(console.error);
