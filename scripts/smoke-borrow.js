const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ADDRESSES_PATH = path.join(__dirname, "..", "docs", "addresses.json");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const borrower = process.env.SMOKE_BORROWER || signer.address;
  const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));

  const weth = addresses.weth;
  const usdg = addresses.usdg;
  const lendingAddress = addresses.lending;
  const sbtAddress = addresses.sbt;
  const oracleAddress = addresses.oracle;

  const borrowAmount = ethers.parseUnits(process.env.SMOKE_BORROW_USDG || "5", 6);
  const collateral = ethers.parseEther(process.env.SMOKE_COLLATERAL_ETH || "0.005");
  const durationDays = Number(process.env.SMOKE_LOAN_DAYS || "30");
  const score = Number(process.env.SMOKE_SCORE || "624");

  console.log("Borrower:", borrower);
  console.log("Lending:", lendingAddress);

  const oracle = await ethers.getContractAt("ChainlinkOracle", oracleAddress);
  const feed = await oracle.priceFeeds(weth);
  if (feed === ethers.ZeroAddress) {
    throw new Error("WETH price feed not wired — run: npx hardhat run scripts/wire-oracle.js --network robinhoodTestnet");
  }

  const collateralValue = await oracle.getValueUSD(weth, collateral);
  console.log("Collateral value:", ethers.formatUnits(collateralValue, 6), "USD");

  const sbt = await ethers.getContractAt("CredScoreSBT", sbtAddress);
  const hasProfile = await sbt.hasProfile(borrower);
  if (!hasProfile) {
    console.log("Minting SBT with score", score);
    await (await sbt.mintSBT(borrower, score, 68, 60, "ipfs://credflow-smoke-test")).wait();
  } else {
    const profile = await sbt.getProfile(borrower);
    console.log("Existing profile — score:", profile.score.toString(), "loanActive:", profile.loanActive);
    if (profile.loanActive) {
      throw new Error("Borrower already has an active loan — repay first or use another wallet");
    }
    if (profile.defaultCount > 0) {
      throw new Error("Borrower has a default on record");
    }
  }

  const lending = await ethers.getContractAt("CredFlowLending", lendingAddress);
  const maxLtv = await lending.getLTVForScore(score);
  const maxBorrow = (collateralValue * BigInt(maxLtv)) / 10000n;
  console.log("Max LTV:", Number(maxLtv) / 100, "% → max borrow:", ethers.formatUnits(maxBorrow, 6), "USDG");
  if (borrowAmount > maxBorrow) {
    throw new Error(`Borrow ${ethers.formatUnits(borrowAmount, 6)} exceeds max ${ethers.formatUnits(maxBorrow, 6)}`);
  }

  const poolBal = await new ethers.Contract(usdg, ERC20_ABI, signer).balanceOf(lendingAddress);
  console.log("Lending pool USDG:", ethers.formatUnits(poolBal, 6));
  if (poolBal < borrowAmount) {
    throw new Error("Insufficient USDG in lending pool");
  }

  const wethContract = new ethers.Contract(weth, WETH_ABI, signer);
  const wethBal = await wethContract.balanceOf(borrower);
  if (wethBal < collateral) {
    console.log("Wrapping", ethers.formatEther(collateral), "ETH → WETH");
    await (await wethContract.deposit({ value: collateral })).wait();
  }

  const allowance = await wethContract.allowance(borrower, lendingAddress);
  if (allowance < collateral) {
    console.log("Approving WETH collateral");
    await (await wethContract.approve(lendingAddress, collateral)).wait();
  }

  const usdgBefore = await new ethers.Contract(usdg, ERC20_ABI, signer).balanceOf(borrower);
  console.log("USDG before:", ethers.formatUnits(usdgBefore, 6));

  console.log("Requesting loan:", ethers.formatUnits(borrowAmount, 6), "USDG for", ethers.formatEther(collateral), "WETH");
  const tx = await lending.requestLoan(borrowAmount, weth, collateral, durationDays);
  const receipt = await tx.wait();
  console.log("LoanCreated in tx:", receipt.hash);

  const usdgAfter = await new ethers.Contract(usdg, ERC20_ABI, signer).balanceOf(borrower);
  console.log("USDG after:", ethers.formatUnits(usdgAfter, 6));
  console.log("Smoke borrow succeeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
