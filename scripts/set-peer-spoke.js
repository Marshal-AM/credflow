const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const lzConfig = require("../layerzero/config.json");

async function main() {
  const network = hre.network.name;
  const spokeFiles = {
    arbitrumSepolia: "spoke-arbitrum-addresses.json",
    baseSepolia: "spoke-base-addresses.json",
  };

  const spokeFile = spokeFiles[network];
  if (!spokeFile) {
    throw new Error(`Run this script on arbitrumSepolia or baseSepolia, not ${network}`);
  }

  const spokePath = path.join(__dirname, "..", "docs", spokeFile);
  if (!fs.existsSync(spokePath)) {
    throw new Error(`Missing ${spokePath} — deploy spoke first`);
  }

  const spoke = JSON.parse(fs.readFileSync(spokePath, "utf8"));
  const hubAddresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
  );

  const hubOApp = process.env.HUB_OAPP_ADDRESS || hubAddresses.oapp;
  const rhEid = lzConfig.robinhoodTestnet.eid;

  const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp);
  await (await oapp.setPeer(rhEid, ethers.zeroPadValue(hubOApp, 32))).wait();

  console.log(`Spoke ${network} (${spoke.oapp}) → Hub (eid ${rhEid}): ${hubOApp}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
