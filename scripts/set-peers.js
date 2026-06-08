const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const lzConfig = require("../layerzero/config.json");

function peerBytes32(address) {
  return ethers.zeroPadValue(address, 32);
}

async function main() {
  const addressesPath = path.join(__dirname, "..", "docs", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const hubOAppAddress = process.env.HUB_OAPP_ADDRESS || addresses.oapp;
  if (!hubOAppAddress || hubOAppAddress === ethers.ZeroAddress) {
    throw new Error("Hub OApp not deployed — run scripts/deploy-oapp.js first");
  }

  const hub = await ethers.getContractAt("CredFlowOApp", hubOAppAddress);
  console.log("Hub CredFlowOApp:", hubOAppAddress);

  if (process.env.ARBITRUM_OAPP_ADDRESS) {
    const eid = Number(process.env.LZ_EID_ARBITRUM || lzConfig.arbitrumSepolia.eid);
    await (await hub.setPeer(eid, peerBytes32(process.env.ARBITRUM_OAPP_ADDRESS))).wait();
    console.log(`Hub → Arbitrum Sepolia (eid ${eid}):`, process.env.ARBITRUM_OAPP_ADDRESS);
  }

  if (process.env.BASE_OAPP_ADDRESS) {
    const eid = Number(process.env.LZ_EID_BASE || lzConfig.baseSepolia.eid);
    await (await hub.setPeer(eid, peerBytes32(process.env.BASE_OAPP_ADDRESS))).wait();
    console.log(`Hub → Base Sepolia (eid ${eid}):`, process.env.BASE_OAPP_ADDRESS);
  }

  console.log("\nRun on each spoke network to complete bidirectional wiring:");
  console.log("  npx hardhat run scripts/set-peer-spoke.js --network arbitrumSepolia");
  console.log("  npx hardhat run scripts/set-peer-spoke.js --network baseSepolia");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
