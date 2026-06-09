const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

async function main() {
  const hub = process.env.HUB_OAPP_ADDRESS || "0x57061d08986D780f5755887207e355bf8f5813D8";
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
