const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
  );
  const agentWallet = process.env.AGENT_WALLET_ADDRESS;
  if (!agentWallet) {
    throw new Error("AGENT_WALLET_ADDRESS not set");
  }

  const lending = await ethers.getContractAt("CredFlowLending", addresses.lending);
  const adminRole = await lending.DEFAULT_ADMIN_ROLE();
  const [deployer] = await ethers.getSigners();

  if (!(await lending.hasRole(adminRole, deployer.address))) {
    throw new Error(`Deployer ${deployer.address} lacks DEFAULT_ADMIN_ROLE on lending`);
  }

  if (await lending.hasRole(adminRole, agentWallet)) {
    console.log("Agent already has DEFAULT_ADMIN_ROLE on lending");
  } else {
    await (await lending.grantRole(adminRole, agentWallet)).wait();
    console.log("Granted DEFAULT_ADMIN_ROLE on lending to", agentWallet);
  }

  console.log("Agent roles ready for rate_optimizer (setBaseRate)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
