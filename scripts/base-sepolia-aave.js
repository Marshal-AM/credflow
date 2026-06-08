/**
 * Base Sepolia Aave v3 activity for CredFlow scoring data (Phase 2.3).
 *
 * Flow: wrap ETH → supply WETH collateral → borrow USDC → repay USDC
 *
 * Usage:
 *   npx hardhat run scripts/base-sepolia-aave.js --network baseSepolia
 *   BASE_SEPOLIA_AAVE_CHECK_ONLY=1  (balances + Aave position only)
 *
 * Env:
 *   BASE_SEPOLIA_AAVE_SUPPLY_ETH=0.001    WETH supplied as collateral
 *   BASE_SEPOLIA_AAVE_BORROW_USDC=0.1     USDC to borrow (6 decimals)
 *   BASE_SEPOLIA_AAVE_MIN_ETH=0.002       minimum native ETH to run
 *   BASE_SEPOLIA_AAVE_DRY_RUN=1           log only
 */

const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

const BASE_SEPOLIA_CHAIN_ID = 84532;
const VARIABLE_RATE_MODE = 2;

// Aave V3 Base Sepolia — bgd-labs/aave-address-book
const AAVE_POOL = "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f";
const WETH_A_TOKEN = "0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
];

const POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];

function checkOnly() {
  return process.env.BASE_SEPOLIA_AAVE_CHECK_ONLY === "1";
}

function dryRun() {
  return process.env.BASE_SEPOLIA_AAVE_DRY_RUN === "1";
}

async function assertBaseSepolia(network) {
  if (Number(network.config.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Use --network baseSepolia (chain ${BASE_SEPOLIA_CHAIN_ID})`);
  }
}

async function ensureAllowance(token, owner, spender, amount, label) {
  const current = await token.allowance(owner, spender);
  if (current >= amount) {
    console.log(`  ${label} allowance OK`);
    return null;
  }
  console.log(`  ${label} approve -> Pool`);
  if (dryRun()) return null;
  const tx = await token.approve(spender, amount);
  console.log("    tx:", tx.hash);
  return tx.wait();
}

async function printStatus(signer) {
  const address = await signer.getAddress();
  const ethBal = await ethers.provider.getBalance(address);
  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
  const aWeth = new ethers.Contract(WETH_A_TOKEN, ERC20_ABI, signer);
  const pool = new ethers.Contract(AAVE_POOL, POOL_ABI, signer);

  const wethBal = await weth.balanceOf(address);
  const usdcBal = await usdc.balanceOf(address);
  const aWethBal = await aWeth.balanceOf(address);

  let account = null;
  try {
    account = await pool.getUserAccountData(address);
  } catch (err) {
    console.log("  (getUserAccountData failed:", err.message, ")");
  }

  console.log("--- Base Sepolia Aave status ---");
  console.log("Wallet:       ", address);
  console.log("ETH balance:  ", ethers.formatEther(ethBal), "ETH");
  console.log("WETH balance: ", ethers.formatEther(wethBal), "WETH");
  console.log("USDC balance: ", ethers.formatUnits(usdcBal, 6), "USDC");
  console.log("aWETH (supplied):", ethers.formatEther(aWethBal), "aWETH");
  if (account) {
    console.log("Aave collateral (base):", ethers.formatUnits(account[0], 8));
    console.log("Aave debt (base):     ", ethers.formatUnits(account[1], 8));
    console.log("Health factor:        ", ethers.formatUnits(account[5], 18));
  }
  console.log("Pool:         ", AAVE_POOL);
  console.log("------------------------------");

  return { address, ethBal, wethBal, usdcBal, aWethBal, account };
}

async function runAaveFlow(signer, status) {
  const supplyEth = process.env.BASE_SEPOLIA_AAVE_SUPPLY_ETH || "0.001";
  const borrowUsdc = process.env.BASE_SEPOLIA_AAVE_BORROW_USDC || "0.1";
  const minEth = process.env.BASE_SEPOLIA_AAVE_MIN_ETH || "0.002";

  const supplyWei = ethers.parseEther(supplyEth);
  const borrowUnits = ethers.parseUnits(borrowUsdc, 6);
  const minWei = ethers.parseEther(minEth);

  if (status.ethBal < minWei) {
    console.log(`\nNeed at least ${minEth} ETH. Fund: https://www.alchemy.com/faucets/base-sepolia`);
    return false;
  }

  const address = status.address;
  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
  const pool = new ethers.Contract(AAVE_POOL, POOL_ABI, signer);

  console.log("\n=== Aave v3 Base Sepolia (supply → borrow → repay) ===");
  console.log(`Supply ${supplyEth} WETH | Borrow ${borrowUsdc} USDC`);

  // Step 1: Wrap ETH if needed
  let wethBal = await weth.balanceOf(address);
  if (wethBal < supplyWei) {
    const wrapAmount = supplyWei - wethBal;
    console.log(`\n[1] WETH deposit ${ethers.formatEther(wrapAmount)} ETH`);
    if (!dryRun()) {
      const tx = await weth.deposit({ value: wrapAmount });
      console.log("  tx:", tx.hash);
      await tx.wait();
    }
    wethBal = await weth.balanceOf(address);
  } else {
    console.log("\n[1] WETH balance sufficient — skip wrap");
  }

  // Step 2: Supply WETH
  console.log(`\n[2] Supply ${supplyEth} WETH to Aave Pool`);
  await ensureAllowance(weth, address, AAVE_POOL, supplyWei, "WETH");
  if (!dryRun()) {
    const tx = await pool.supply(WETH, supplyWei, address, 0);
    console.log("  tx:", tx.hash);
    await tx.wait();
  }

  // Step 3: Borrow USDC
  console.log(`\n[3] Borrow ${borrowUsdc} USDC (variable rate)`);
  if (!dryRun()) {
    const tx = await pool.borrow(USDC, borrowUnits, VARIABLE_RATE_MODE, 0, address);
    console.log("  tx:", tx.hash);
    await tx.wait();
  }

  const usdcAfterBorrow = await usdc.balanceOf(address);
  console.log("  USDC wallet balance:", ethers.formatUnits(usdcAfterBorrow, 6));

  // Step 4: Repay all USDC debt
  console.log("\n[4] Repay USDC debt (max)");
  await ensureAllowance(usdc, address, AAVE_POOL, ethers.MaxUint256, "USDC");
  if (!dryRun()) {
    const tx = await pool.repay(USDC, ethers.MaxUint256, VARIABLE_RATE_MODE, address);
    console.log("  tx:", tx.hash);
    await tx.wait();
  }

  console.log("\n=== Aave flow complete ===");
  console.log("On-chain borrow/repay events emitted for wallet", address);
  console.log("Note: Dune lending.borrow indexes mainnet 'base' chain — Sepolia events");
  console.log("      may not appear in Dune yet. CredFlow indexer can still use RPC logs later.");
  return true;
}

async function main() {
  await assertBaseSepolia(hre.network);
  const [signer] = await ethers.getSigners();
  const status = await printStatus(signer);

  if (checkOnly()) {
    console.log("\nBASE_SEPOLIA_AAVE_CHECK_ONLY=1 — no transactions sent.");
    return;
  }

  await runAaveFlow(signer, status);
  console.log("\n--- Post-flow status ---");
  await printStatus(signer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
