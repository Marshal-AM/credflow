const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

const { loadSpokeConfig } = require("./lib/spoke-config");

async function main() {
  const { cfg, addresses } = loadSpokeConfig();
  const [deployer] = await ethers.getSigners();

  if (!addresses.lending) {
    throw new Error("Spoke lending not deployed — run deploy-spoke-lending.js first");
  }

  const usdc = await ethers.getContractAt(
    [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
    ],
    cfg.usdc
  );

  const deployerBal = await usdc.balanceOf(deployer.address);
  const lendingBalBefore = await usdc.balanceOf(addresses.lending);
  const requested = ethers.parseUnits(process.env.FUND_USDC || process.env.SPOKE_LENDING_FUND_USDC || "10", 6);
  const amount = deployerBal < requested ? deployerBal : requested;

  console.log("Spoke lending:", addresses.lending);
  console.log("Deployer USDC:", ethers.formatUnits(deployerBal, 6));
  console.log("Lending USDC before:", ethers.formatUnits(lendingBalBefore, 6));
  console.log("Requested:", ethers.formatUnits(requested, 6), "USDC");

  if (amount === 0n) {
    throw new Error("No USDC available to fund spoke lending");
  }

  if (amount < requested) {
    console.warn("Funding available balance instead:", ethers.formatUnits(amount, 6), "USDC");
  } else {
    console.log("Funding:", ethers.formatUnits(amount, 6), "USDC");
  }

  const tx = await usdc.transfer(addresses.lending, amount);
  await tx.wait();
  console.log("Transfer tx:", tx.hash);
  console.log("Lending USDC after:", ethers.formatUnits(await usdc.balanceOf(addresses.lending), 6));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
