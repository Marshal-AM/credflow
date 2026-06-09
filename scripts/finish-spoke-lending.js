/**
 * Resume spoke lending deploy when oracle/pool already exist (e.g. rate-limit mid-deploy).
 * Usage: SPOKE=base EXISTING_ORACLE=0x... EXISTING_POOL=0x... EXISTING_FEED=0x... hardhat run scripts/finish-spoke-lending.js --network baseSepolia
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { loadSpokeConfig, exportAbis, ABIS_TO_EXPORT, ROOT } = require("./lib/spoke-config");

async function main() {
  const oracleAddr = process.env.EXISTING_ORACLE;
  const poolAddr = process.env.EXISTING_POOL;
  const feedAddr = process.env.EXISTING_FEED;
  const lendingAddr = process.env.EXISTING_LENDING;
  if (!oracleAddr || !poolAddr || !feedAddr) {
    throw new Error("Set EXISTING_ORACLE, EXISTING_POOL, EXISTING_FEED");
  }

  const delayMs = Number(process.env.TX_DELAY_MS || 15000);
  const pause = () => new Promise((r) => setTimeout(r, delayMs));

  const { key, cfg, addresses, addressesPath } = loadSpokeConfig();
  const [deployer] = await ethers.getSigners();
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  console.log("Finish spoke lending —", key);
  console.log("Oracle:", oracleAddr, "Pool:", poolAddr, "Feed:", feedAddr);

  let lending;
  if (lendingAddr) {
    lending = await ethers.getContractAt("CredFlowSpokeLending", lendingAddr);
    console.log("CredFlowSpokeLending (existing):", lendingAddr);
  } else {
    const Lending = await ethers.getContractFactory("CredFlowSpokeLending");
    lending = await Lending.deploy(addresses.oapp, oracleAddr, cfg.usdc, deployer.address);
    await lending.waitForDeployment();
    console.log("CredFlowSpokeLending:", await lending.getAddress());
    await pause();
  }

  const pool = await ethers.getContractAt("CredFlowLP", poolAddr);
  await (await pool.setLendingContract(await lending.getAddress())).wait();
  console.log("pool.setLendingContract done");
  await pause();
  await (await lending.setLiquidityPool(poolAddr)).wait();
  console.log("lending.setLiquidityPool done");
  await pause();
  await (await lending.grantRole(await lending.AGENT_ROLE(), agentWallet)).wait();
  console.log("AGENT_ROLE on lending granted to", agentWallet);
  await pause();

  const fundAmount = ethers.parseUnits(process.env.SPOKE_LENDING_FUND_USDC || "50", 6);
  const usdc = await ethers.getContractAt(
    ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    cfg.usdc
  );
  const deployerBal = await usdc.balanceOf(deployer.address);
  if (deployerBal >= fundAmount) {
    await (await usdc.transfer(await lending.getAddress(), fundAmount)).wait();
    console.log("Funded lending with", ethers.formatUnits(fundAmount, 6), "USDC");
  } else {
    console.warn("Deployer USDC insufficient — have", ethers.formatUnits(deployerBal, 6));
  }

  const payload = {
    ...addresses,
    chain: key,
    weth: cfg.weth,
    usdc: cfg.usdc,
    oracle: oracleAddr,
    pool: poolAddr,
    lending: await lending.getAddress(),
    wethPriceFeed: feedAddr,
    mainnetChainlinkFeed: cfg.ethUsdFeed,
    oracleFeedSource: "ChainlinkMirrorFeed",
    chainId: cfg.chainId,
  };
  fs.writeFileSync(addressesPath, JSON.stringify(payload, null, 2));
  console.log("Saved", addressesPath);

  const frontendPath = path.join(ROOT, "frontend", "src", "lib", cfg.addressFile);
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.copyFileSync(addressesPath, frontendPath);

  exportAbis([...ABIS_TO_EXPORT, "ChainlinkMirrorFeed"]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
