const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { buildLzOptions } = require("../layerzero/buildLzOptions");

async function main() {
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
  );
  const hubOApp = process.env.HUB_OAPP_ADDRESS || addresses.oapp;
  const wallet = process.env.AGENT_WALLET_ADDRESS;
  const score = 842;
  const eids = [40231, 40245];
  const options = "0x" + buildLzOptions(200000);

  const perDest = BigInt(process.env.LZ_NATIVE_FEE_PER_DST || "700000000000000");
  const value = perDest * BigInt(eids.length);

  const oapp = await ethers.getContractAt("CredFlowOApp", hubOApp);
  console.log("broadcastScore", { wallet, score, eids, value: value.toString() });

  const tx = await oapp.broadcastScore(eids, wallet, score, options, { value });
  const receipt = await tx.wait();
  console.log("tx:", receipt.hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
