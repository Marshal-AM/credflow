const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");

async function main() {
  const [agent] = await ethers.getSigners();
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));

  const sbt = await ethers.getContractAt("CredScoreSBT", addresses.sbt);
  const lending = await ethers.getContractAt("CredFlowLending", addresses.lending);

  const borrower = agent.address;
  const defaulter = "0x000000000000000000000000000000000000dEaD";
  const linkedWallet = ethers.Wallet.createRandom().address;

  console.log("SBT:", addresses.sbt);
  console.log("Lending:", addresses.lending);
  console.log("Agent:", agent.address);
  console.log("Blacklisting wallet:", linkedWallet);

  const agentRole = await sbt.AGENT_ROLE();
  if (!(await sbt.hasRole(agentRole, agent.address))) {
    throw new Error(`Agent ${agent.address} lacks AGENT_ROLE on SBT`);
  }

  const tx = await sbt.blacklistLinkedWallets([linkedWallet], defaulter);
  await tx.wait();
  console.log("blacklistLinkedWallets tx:", tx.hash);

  const isBlacklisted = await sbt.isBlacklisted(linkedWallet);
  if (!isBlacklisted) {
    throw new Error("Expected wallet to be blacklisted");
  }
  console.log("isBlacklisted:", isBlacklisted);
  console.log("blacklistedVia:", await sbt.blacklistedVia(linkedWallet));

  const borrowAmount = ethers.parseUnits(process.env.SMOKE_BORROW_USDG || "5", 6);
  const collateral = ethers.parseEther(process.env.SMOKE_COLLATERAL_ETH || "0.001");
  try {
    await lending.requestLoan.staticCall(borrowAmount, addresses.weth, collateral, 30);
    throw new Error("Expected requestLoan to revert for blacklisted wallet");
  } catch (err) {
    const msg = err.shortMessage || err.message || "";
    if (!msg.includes("Wallet blacklisted")) {
      throw err;
    }
    console.log("requestLoan correctly reverted: Wallet blacklisted");
  }

  console.log("Blacklist smoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
