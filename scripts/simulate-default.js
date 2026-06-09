const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");

async function main() {
  const loanId = Number(process.argv[2] || process.env.SIMULATE_LOAN_ID || "1");
  const crashPriceUsd = Number(process.env.SIMULATE_ETH_PRICE_USD || "200");

  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const weth = process.env.WETH_ROBINHOOD || addresses.weth;
  const oracleAddress = process.env.PRICE_ORACLE || addresses.oracle;

  const oracle = await ethers.getContractAt("ChainlinkOracle", oracleAddress);
  const feed = await oracle.priceFeeds(weth);
  if (feed === ethers.ZeroAddress) {
    throw new Error("WETH feed not wired — run npm run oracle:wire");
  }

  const feedContract = await ethers.getContractAt("MockChainlinkFeed", feed);
  const owner = await feedContract.owner();
  const [signer] = await ethers.getSigners();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not feed owner (${owner})`);
  }

  const newPrice = BigInt(crashPriceUsd) * 10n ** 8n;
  await (await feedContract.setPrice(newPrice)).wait();
  console.log(`ETH price crashed to $${crashPriceUsd} on feed ${feed}`);

  const lending = await ethers.getContractAt("CredFlowLending", addresses.lending);
  const loan = await lending.loans(loanId);
  if (!loan.active) {
    throw new Error(`Loan ${loanId} is not active`);
  }

  const ltv = await lending.getCurrentLTV(loanId);
  const threshold = await lending.liquidationThreshold();
  console.log(`Loan ${loanId} LTV bps: ${ltv} (liquidation threshold ${threshold})`);

  if (ltv < threshold) {
    console.warn("LTV still below liquidation threshold — lower SIMULATE_ETH_PRICE_USD further");
  } else {
    console.log("Loan is liquidatable — run: npm run agent:liquidate -- --loan-id", loanId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
