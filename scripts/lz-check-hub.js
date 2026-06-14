const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

async function main() {
  const hub = process.env.HUB_OAPP_ADDRESS || "0x082cd48325327f683f1005652D649C951118b7F2";
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
