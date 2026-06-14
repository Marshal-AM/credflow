/**
 * Wire Base spoke pool ↔ lending after partial deploy (in-flight tx limits).
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "spoke-base-addresses.json");

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const lendingAddress = addresses.lending || process.env.BASE_LENDING_ADDRESS;
  if (!lendingAddress) throw new Error("Set lending in spoke-base-addresses.json");
  const [deployer] = await ethers.getSigners();
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  const pool = await ethers.getContractAt("CredFlowLP", addresses.pool);
  const lending = await ethers.getContractAt("CredFlowSpokeLending", lendingAddress);

  const poolLending = await pool.lendingContract();
  if (poolLending.toLowerCase() !== lendingAddress.toLowerCase()) {
    await wait(5000);
    await (await pool.setLendingContract(lendingAddress)).wait();
    console.log("Pool → lending wired");
  }

  const lendingPool = await lending.liquidityPool();
  if (lendingPool === ethers.ZeroAddress) {
    await wait(5000);
    await (await lending.setLiquidityPool(addresses.pool)).wait();
    console.log("Lending → pool wired");
  }

  const role = await lending.AGENT_ROLE();
  if (!(await lending.hasRole(role, agentWallet))) {
    await wait(5000);
    await (await lending.grantRole(role, agentWallet)).wait();
    console.log("AGENT_ROLE granted");
  }

  const fundAmount = ethers.parseUnits(process.env.SPOKE_LENDING_FUND_USDC || "50", 6);
  const usdc = await ethers.getContractAt(
    ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    addresses.usdc
  );
  const lendingBal = await usdc.balanceOf(lendingAddress);
  if (lendingBal < fundAmount) {
    const deployerBal = await usdc.balanceOf(deployer.address);
    const need = fundAmount - lendingBal;
    if (deployerBal >= need) {
      await wait(5000);
      await (await usdc.transfer(lendingAddress, need)).wait();
      console.log("Funded lending with", ethers.formatUnits(need, 6), "USDC");
    }
  }

  addresses.lending = lendingAddress;
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));
  const frontendPath = path.join(__dirname, "..", "frontend", "src", "lib", "spoke-base-addresses.json");
  fs.copyFileSync(ADDRESSES_PATH, frontendPath);
  console.log("Base spoke wiring complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
