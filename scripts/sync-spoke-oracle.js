const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
require("dotenv").config();

const { fetchPrice, NETWORKS } = require("./lib/chainlink-price");
const { loadSpokeConfig, ROOT } = require("./lib/spoke-config");

async function deployMirrorFeed(spokeKey, deployer) {
  const mainnet = await fetchPrice(spokeKey);
  if (mainnet.isStale) {
    console.warn("WARNING: mainnet feed stale —", mainnet.ageSeconds, "s old");
  }

  const initialPrice = BigInt(mainnet.answer);
  const Mirror = await ethers.getContractFactory("ChainlinkMirrorFeed");
  const mirror = await Mirror.deploy(
    initialPrice,
    mainnet.address,
    mainnet.network,
    deployer.address
  );
  await mirror.waitForDeployment();
  const addr = await mirror.getAddress();
  console.log(
    "ChainlinkMirrorFeed:",
    addr,
    `(mainnet ${mainnet.network} @ ${mainnet.address}, $${mainnet.price.toFixed(2)})`
  );
  return { mirror, mainnet, feedAddress: addr, source: "ChainlinkMirrorFeed" };
}

async function syncExistingMirror(spokeKey, mirrorAddress, deployer) {
  const mainnet = await fetchPrice(spokeKey);
  const mirror = await ethers.getContractAt("ChainlinkMirrorFeed", mirrorAddress);
  const owner = await mirror.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer is not mirror owner (${owner})`);
  }

  const tx = await mirror.syncPrice(BigInt(mainnet.answer));
  await tx.wait();
  console.log(
    "Synced mirror",
    mirrorAddress,
    "→",
    `$${mainnet.price.toFixed(2)}`,
    "from",
    mainnet.network,
    mainnet.address
  );
  return { mainnet, tx: tx.hash };
}

async function wireOracle(oracleAddress, weth, feedAddress) {
  const oracle = await ethers.getContractAt("ChainlinkOracle", oracleAddress);
  const existing = await oracle.priceFeeds(weth);
  if (existing.toLowerCase() !== feedAddress.toLowerCase()) {
    await (await oracle.setPriceFeed(weth, feedAddress, 18)).wait();
    console.log("setPriceFeed(WETH):", feedAddress);
  }
  const valueUsd = await oracle.getValueUSD(weth, ethers.parseEther("0.01"));
  console.log("Oracle check: 0.01 WETH =", ethers.formatUnits(valueUsd, 6), "USD");
}

async function main() {
  const spokeKey = (process.env.SPOKE || process.argv[2] || "arbitrum").toLowerCase();
  if (!NETWORKS[spokeKey]) {
    throw new Error(`Unknown spoke '${spokeKey}'. Use: arbitrum | base`);
  }

  const { cfg, addresses, addressesPath } = loadSpokeConfig(spokeKey);
  const [deployer] = await ethers.getSigners();

  console.log("Sync spoke oracle from mainnet Chainlink —", spokeKey);
  console.log("Network:", hre.network.name);
  console.log("Mainnet feed:", NETWORKS[spokeKey].feedAddress);

  let feedAddress = addresses.wethPriceFeed;
  let source = addresses.oracleFeedSource || "ChainlinkMirrorFeed";

  // Replace legacy MockChainlinkFeed deployments
  if (source === "MockChainlinkFeed" || process.env.DEPLOY_MIRROR === "1") {
    console.log("Deploying new ChainlinkMirrorFeed (replacing legacy feed)...");
    const deployed = await deployMirrorFeed(spokeKey, deployer);
    feedAddress = deployed.feedAddress;
    source = deployed.source;

    if (addresses.oracle) {
      await wireOracle(addresses.oracle, cfg.weth, feedAddress);
    }
  } else {
    await syncExistingMirror(spokeKey, feedAddress, deployer);
    if (addresses.oracle) {
      await wireOracle(addresses.oracle, cfg.weth, feedAddress);
    }
  }

  const updated = {
    ...addresses,
    weth: cfg.weth,
    usdc: cfg.usdc,
    wethPriceFeed: feedAddress,
    mainnetChainlinkFeed: NETWORKS[spokeKey].feedAddress,
    oracleFeedSource: source,
  };
  fs.writeFileSync(addressesPath, JSON.stringify(updated, null, 2));

  const frontendPath = require("path").join(ROOT, "frontend", "src", "lib", cfg.addressFile);
  fs.copyFileSync(addressesPath, frontendPath);
  console.log("Updated", addressesPath);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { deployMirrorFeed, syncExistingMirror, wireOracle, main };
