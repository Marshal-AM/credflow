const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));

  const weth = process.env.WETH_ROBINHOOD || addresses.weth;
  const oracleAddress = process.env.PRICE_ORACLE || addresses.oracle;
  const configuredFeed = process.env.CHAINLINK_ETH_USD_FEED;

  const oracle = await ethers.getContractAt("ChainlinkOracle", oracleAddress);
  const owner = await oracle.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer ${deployer.address} is not oracle owner (${owner})`);
  }

  let feedAddress = configuredFeed;
  let feedSource = "CHAINLINK_ETH_USD_FEED";

  if (feedAddress) {
    const code = await ethers.provider.getCode(feedAddress);
    if (code === "0x") {
      throw new Error(`Feed ${feedAddress} has no bytecode on this network`);
    }
    console.log("Using configured Chainlink feed:", feedAddress);
  } else {
    console.log("No CHAINLINK_ETH_USD_FEED — deploying MockChainlinkFeed for testnet");
    const ethUsd = Number(process.env.MOCK_ETH_USD_PRICE || "3000");
    const initialPrice = BigInt(ethUsd) * 10n ** 8n;

    const MockFeed = await ethers.getContractFactory("MockChainlinkFeed");
    const mockFeed = await MockFeed.deploy(initialPrice, deployer.address);
    await mockFeed.waitForDeployment();
    feedAddress = await mockFeed.getAddress();
    feedSource = "MockChainlinkFeed";
    console.log("MockChainlinkFeed:", feedAddress, `($${ethUsd})`);
  }

  const existing = await oracle.priceFeeds(weth);
  if (existing.toLowerCase() === feedAddress.toLowerCase()) {
    console.log("WETH feed already wired:", feedAddress);
  } else {
    const tx = await oracle.setPriceFeed(weth, feedAddress, 18);
    await tx.wait();
    console.log("setPriceFeed(WETH):", feedAddress);
  }

  const wethAmount = ethers.parseEther("0.01");
  const valueUsd = await oracle.getValueUSD(weth, wethAmount);
  console.log("Oracle check: 0.01 WETH =", ethers.formatUnits(valueUsd, 6), "USD");

  addresses.oracle = oracleAddress;
  addresses.wethPriceFeed = feedAddress;
  addresses.oracleFeedSource = feedSource;
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2));

  const frontendPath = path.join(__dirname, "..", "frontend", "src", "lib", "addresses.json");
  fs.copyFileSync(ADDRESSES_PATH, frontendPath);
  console.log("Updated docs/addresses.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
