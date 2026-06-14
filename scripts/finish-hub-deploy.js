/**
 * Complete role grants + lending fund after deploy.js interrupted (e.g. nonce race).
 * Usage: npx hardhat run scripts/finish-hub-deploy.js --network robinhoodTestnet
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");

async function grantIfMissing(contract, role, account, label) {
  if (await contract.hasRole(role, account)) {
    console.log(`${label}: already has role`);
    return;
  }
  const tx = await contract.grantRole(role, account);
  await tx.wait();
  console.log(`${label}: granted`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  const sbt = await ethers.getContractAt("CredScoreSBT", addresses.sbt);
  const scoreEngine = await ethers.getContractAt("CredScoreEngine", addresses.scoreEngine);
  const lending = await ethers.getContractAt("CredFlowLending", addresses.lending);
  const pool = await ethers.getContractAt("CredFlowLP", addresses.pool);
  const oapp = await ethers.getContractAt("CredFlowOApp", addresses.oapp);

  const poolLending = await pool.lendingContract();
  if (poolLending === ethers.ZeroAddress) {
    await (await pool.setLendingContract(addresses.lending)).wait();
    console.log("Pool → lending wired");
  }
  const lendingPool = await lending.liquidityPool();
  if (lendingPool === ethers.ZeroAddress) {
    await (await lending.setLiquidityPool(addresses.pool)).wait();
    console.log("Lending → pool wired");
  }

  await grantIfMissing(sbt, await sbt.SCORER_ROLE(), addresses.scoreEngine, "SBT → engine SCORER");
  await grantIfMissing(scoreEngine, await scoreEngine.SCORER_ROLE(), agentWallet, "Engine → agent SCORER");
  await grantIfMissing(sbt, await sbt.SCORER_ROLE(), agentWallet, "SBT → agent SCORER");
  await grantIfMissing(sbt, await sbt.AGENT_ROLE(), agentWallet, "SBT → agent AGENT");
  await grantIfMissing(sbt, await sbt.AGENT_ROLE(), addresses.lending, "SBT → lending AGENT");
  await grantIfMissing(lending, await lending.AGENT_ROLE(), agentWallet, "Lending → agent AGENT");
  await grantIfMissing(oapp, await oapp.AGENT_ROLE(), agentWallet, "OApp → agent AGENT");

  const fundAmount = ethers.parseUnits(process.env.LENDING_FUND_USDG || "10000", 6);
  const usdg = await ethers.getContractAt(
    ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    addresses.usdg
  );
  const lendingBal = await usdg.balanceOf(addresses.lending);
  if (lendingBal < fundAmount) {
    const deployerBal = await usdg.balanceOf(deployer.address);
    const need = fundAmount - lendingBal;
    if (deployerBal >= need) {
      await (await usdg.transfer(addresses.lending, need)).wait();
      console.log("Funded lending with", ethers.formatUnits(need, 6), "USDG");
    } else {
      console.warn("Insufficient USDG to fund lending — run fund-lending.js");
    }
  } else {
    console.log("Lending already funded:", ethers.formatUnits(lendingBal, 6), "USDG");
  }

  const frontendLib = path.join(__dirname, "..", "frontend", "src", "lib", "addresses.json");
  fs.mkdirSync(path.dirname(frontendLib), { recursive: true });
  fs.copyFileSync(ADDRESSES_PATH, frontendLib);
  console.log("Hub deploy finish complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
