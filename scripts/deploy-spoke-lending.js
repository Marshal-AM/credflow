const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { fetchPrice, NETWORKS } = require("./lib/chainlink-price");
const { loadSpokeConfig, exportAbis, ABIS_TO_EXPORT, ROOT } = require("./lib/spoke-config");

async function deployMainnetMirrorFeed(spokeKey, deployer) {
  const mainnet = await fetchPrice(spokeKey);
  if (mainnet.isStale) {
    console.warn("WARNING: mainnet Chainlink feed is stale —", mainnet.ageSeconds, "s");
  }

  const Mirror = await ethers.getContractFactory("ChainlinkMirrorFeed");
  const mirror = await Mirror.deploy(
    BigInt(mainnet.answer),
    mainnet.address,
    mainnet.network,
    deployer.address
  );
  await mirror.waitForDeployment();
  const feedAddress = await mirror.getAddress();
  console.log(
    "ChainlinkMirrorFeed:",
    feedAddress,
    `← mainnet ${mainnet.network} ${mainnet.address} ($${mainnet.price.toFixed(2)})`
  );
  return { feedAddress, mainnet, source: "ChainlinkMirrorFeed" };
}

async function wireWethFeed(oracle, weth, feedAddress) {
  const code = await ethers.provider.getCode(feedAddress);
  if (code === "0x") {
    throw new Error(`Feed ${feedAddress} has no bytecode`);
  }
  const existing = await oracle.priceFeeds(weth);
  if (existing.toLowerCase() !== feedAddress.toLowerCase()) {
    await (await oracle.setPriceFeed(weth, feedAddress, 18)).wait();
    console.log("setPriceFeed(WETH):", feedAddress);
    await new Promise((r) => setTimeout(r, 3000));
  }
  let valueUsd;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      valueUsd = await oracle.getValueUSD(weth, ethers.parseEther("0.01"));
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log("Oracle check: 0.01 WETH =", ethers.formatUnits(valueUsd, 6), "USD");
}

async function main() {
  const { key, cfg, addresses, addressesPath } = loadSpokeConfig();
  const spokeKey = cfg.mainnetChainlinkKey || key;
  if (!NETWORKS[spokeKey]) {
    throw new Error(`No mainnet Chainlink mapping for spoke '${key}'`);
  }

  const [deployer] = await ethers.getSigners();
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  console.log("Deploy spoke lending —", key);
  console.log("Network:", hre.network.name);
  console.log("Mainnet price source:", NETWORKS[spokeKey].feedAddress, "(via scripts/chainlink.js)");

  if (!addresses.oapp || addresses.oapp === ethers.ZeroAddress) {
    throw new Error("Spoke OApp missing — run deploy-spoke.js first");
  }

  const { feedAddress, mainnet, source } = await deployMainnetMirrorFeed(spokeKey, deployer);

  const Oracle = await ethers.getContractFactory("ChainlinkOracle");
  const oracle = await Oracle.deploy(deployer.address);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("ChainlinkOracle:", oracleAddress);
  await new Promise((r) => setTimeout(r, 5000));
  await wireWethFeed(await ethers.getContractAt("ChainlinkOracle", oracleAddress), cfg.weth, feedAddress);

  const Pool = await ethers.getContractFactory("CredFlowLP");
  const pool = await Pool.deploy(cfg.usdc);
  await pool.waitForDeployment();
  console.log("CredFlowLP:", await pool.getAddress());

  const Lending = await ethers.getContractFactory("CredFlowSpokeLending");
  const lending = await Lending.deploy(
    addresses.oapp,
    oracleAddress,
    cfg.usdc,
    deployer.address
  );
  await lending.waitForDeployment();
  console.log("CredFlowSpokeLending:", await lending.getAddress());

  await (await pool.setLendingContract(await lending.getAddress())).wait();
  await (await lending.setLiquidityPool(await pool.getAddress())).wait();
  await (await lending.grantRole(await lending.AGENT_ROLE(), agentWallet)).wait();
  console.log("AGENT_ROLE on lending granted to", agentWallet);

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
    console.warn(
      "Deployer USDC insufficient — have",
      ethers.formatUnits(deployerBal, 6),
      "— run fund-spoke-lending.js"
    );
  }

  const payload = {
    ...addresses,
    chain: key,
    weth: cfg.weth,
    usdc: cfg.usdc,
    oracle: oracleAddress,
    pool: await pool.getAddress(),
    lending: await lending.getAddress(),
    wethPriceFeed: feedAddress,
    mainnetChainlinkFeed: mainnet.address,
    oracleFeedSource: source,
    chainId: cfg.chainId,
  };
  fs.writeFileSync(addressesPath, JSON.stringify(payload, null, 2));
  console.log("Saved", addressesPath);

  const frontendPath = path.join(ROOT, "frontend", "src", "lib", cfg.addressFile);
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.copyFileSync(addressesPath, frontendPath);

  exportAbis([...ABIS_TO_EXPORT, "ChainlinkMirrorFeed"]);
  console.log("\nBefore borrow, refresh price: npm run sync:spoke:oracle:" + key);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
