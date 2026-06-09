const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

const { loadSpokeConfig } = require("./lib/spoke-config");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const WETH_ABI = [...ERC20_ABI, "function deposit() payable"];

async function main() {
  const { addresses, cfg } = loadSpokeConfig();
  const [signer] = await ethers.getSigners();
  const borrower = process.env.SMOKE_BORROWER || signer.address;

  const borrowAmount = ethers.parseUnits(process.env.SMOKE_BORROW_USDC || "0.5", 6);
  const collateral = ethers.parseEther(process.env.SMOKE_COLLATERAL_ETH || "0.005");
  const durationDays = Number(process.env.SMOKE_LOAN_DAYS || "30");

  console.log("Borrower:", borrower);
  console.log("Spoke OApp:", addresses.oapp);
  console.log("Spoke lending:", addresses.lending);

  const oapp = await ethers.getContractAt("CredFlowOApp", addresses.oapp);
  const score = await oapp.getScore(borrower);
  console.log("LZ score:", score.toString());
  if (score === 0n) {
    throw new Error("No LZ score — run agent:sync after hub underwrite");
  }
  if (await oapp.isBlacklisted(borrower)) {
    throw new Error("Borrower is blacklisted on spoke OApp");
  }
  if (await oapp.isLoanActive(borrower)) {
    throw new Error("Cross-chain loan active — repay hub loan or broadcast repaid");
  }

  const oracle = await ethers.getContractAt("ChainlinkOracle", addresses.oracle);
  const feed = await oracle.priceFeeds(cfg.weth);
  if (feed === ethers.ZeroAddress) {
    throw new Error("WETH feed not wired — run wire-spoke-oracle.js");
  }

  const collateralValue = await oracle.getValueUSD(cfg.weth, collateral);
  console.log("Collateral value:", ethers.formatUnits(collateralValue, 6), "USD");

  const lending = await ethers.getContractAt("CredFlowSpokeLending", addresses.lending);
  const maxLtv = await lending.getLTVForScore(score);
  const maxBorrow = (collateralValue * BigInt(maxLtv)) / 10000n;
  console.log("Max LTV:", Number(maxLtv) / 100, "% → max borrow:", ethers.formatUnits(maxBorrow, 6), "USDC");

  if (borrowAmount > maxBorrow) {
    throw new Error(`Borrow ${ethers.formatUnits(borrowAmount, 6)} exceeds max ${ethers.formatUnits(maxBorrow, 6)}`);
  }

  const usdc = new ethers.Contract(cfg.usdc, ERC20_ABI, signer);
  const poolBal = await usdc.balanceOf(addresses.lending);
  if (poolBal < borrowAmount) {
    throw new Error("Insufficient USDC in spoke lending pool — run fund-spoke-lending.js");
  }

  const weth = new ethers.Contract(cfg.weth, WETH_ABI, signer);
  if ((await weth.balanceOf(borrower)) < collateral) {
    console.log("Wrapping", ethers.formatEther(collateral), "ETH → WETH");
    await (await weth.deposit({ value: collateral })).wait();
  }

  if ((await weth.allowance(borrower, addresses.lending)) < collateral) {
    await (await weth.approve(addresses.lending, collateral)).wait();
  }

  const usdcBefore = await usdc.balanceOf(borrower);
  console.log("Requesting loan:", ethers.formatUnits(borrowAmount, 6), "USDC");
  const tx = await lending.requestLoan(borrowAmount, cfg.weth, collateral, durationDays);
  const receipt = await tx.wait();
  console.log("LoanCreated tx:", receipt.hash);
  console.log("USDC received:", ethers.formatUnits((await usdc.balanceOf(borrower)) - usdcBefore, 6));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
