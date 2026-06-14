/**
 * Finish Base spoke lending when deploy-spoke-lending.js hit in-flight tx limit mid-run.
 * Usage: ALCHEMY_BASE_SEPOLIA_RPC= RPC_BASE_SEPOLIA=https://sepolia.base.org \
 *   npx hardhat run scripts/finish-base-spoke-lending.js --network baseSepolia
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const spokeTokens = require("../config/spoke-tokens.json");

async function main() {
  const cfg = spokeTokens.base;
  const addressesPath = path.join(__dirname, "..", "docs", cfg.addressFile);
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const [deployer] = await ethers.getSigners();
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  if (!addresses.oapp) throw new Error("Base OApp missing");
  if (!addresses.oracle) throw new Error("Base oracle missing — run deploy-spoke-lending first");
  if (!addresses.pool) throw new Error("Base pool missing — run deploy-spoke-lending first");
  if (addresses.lending) {
    console.log("Base lending already set:", addresses.lending);
    return;
  }

  const Lending = await ethers.getContractFactory("CredFlowSpokeLending");
  const lending = await Lending.deploy(
    addresses.oapp,
    addresses.oracle,
    cfg.usdc,
    deployer.address
  );
  await lending.waitForDeployment();
  const lendingAddress = await lending.getAddress();
  console.log("CredFlowSpokeLending:", lendingAddress);

  const pool = await ethers.getContractAt("CredFlowLP", addresses.pool);
  await (await pool.setLendingContract(lendingAddress)).wait();
  await (await lending.setLiquidityPool(addresses.pool)).wait();
  await (await lending.grantRole(await lending.AGENT_ROLE(), agentWallet)).wait();
  console.log("Wired pool ↔ lending, granted AGENT_ROLE");

  const fundAmount = ethers.parseUnits(process.env.SPOKE_LENDING_FUND_USDC || "50", 6);
  const usdc = await ethers.getContractAt(
    ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    cfg.usdc
  );
  const deployerBal = await usdc.balanceOf(deployer.address);
  if (deployerBal >= fundAmount) {
    await (await usdc.transfer(lendingAddress, fundAmount)).wait();
    console.log("Funded lending with", ethers.formatUnits(fundAmount, 6), "USDC");
  } else {
    console.warn("Insufficient USDC — run fund-spoke-lending.js");
  }

  const payload = {
    ...addresses,
    chain: "base",
    weth: cfg.weth,
    usdc: cfg.usdc,
    lending: lendingAddress,
    chainId: cfg.chainId,
  };
  fs.writeFileSync(addressesPath, JSON.stringify(payload, null, 2));
  const frontendPath = path.join(__dirname, "..", "frontend", "src", "lib", cfg.addressFile);
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.copyFileSync(addressesPath, frontendPath);
  console.log("Updated", addressesPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
