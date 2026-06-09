const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const wallet = process.env.AGENT_WALLET_ADDRESS || process.argv[2];
  const spokeFiles = {
    arbitrumSepolia: "spoke-arbitrum-addresses.json",
    baseSepolia: "spoke-base-addresses.json",
  };

  for (const [network, file] of Object.entries(spokeFiles)) {
    const spoke = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "docs", file), "utf8")
    );
    const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp);
    const score = await oapp.getScore(wallet);
    console.log(`${network} spoke ${spoke.oapp}: score=${score}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
