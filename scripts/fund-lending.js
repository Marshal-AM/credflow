const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const amount = ethers.parseUnits(process.env.FUND_USDG || "10", 6);

  const usdg = await ethers.getContractAt(
    [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
    ],
    addresses.usdg
  );

  const deployerBal = await usdg.balanceOf(deployer.address);
  const lendingBalBefore = await usdg.balanceOf(addresses.lending);

  console.log("Deployer:", deployer.address);
  console.log("Lending:", addresses.lending);
  console.log("Deployer USDG:", ethers.formatUnits(deployerBal, 6));
  console.log("Lending USDG before:", ethers.formatUnits(lendingBalBefore, 6));
  console.log("Funding amount:", ethers.formatUnits(amount, 6), "USDG");

  if (deployerBal < amount) {
    throw new Error(
      `Insufficient USDG. Have ${ethers.formatUnits(deployerBal, 6)}, need ${ethers.formatUnits(amount, 6)}`
    );
  }

  const tx = await usdg.transfer(addresses.lending, amount);
  await tx.wait();

  const lendingBalAfter = await usdg.balanceOf(addresses.lending);
  console.log("Transfer tx:", tx.hash);
  console.log("Lending USDG after:", ethers.formatUnits(lendingBalAfter, 6));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
