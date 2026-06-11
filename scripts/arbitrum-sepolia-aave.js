/**
 * Arbitrum Sepolia Aave v3 activity for CredFlow scoring data.
 *
 * Flow: wrap ETH → supply WETH collateral → borrow USDC → repay USDC
 *
 * Usage:
 *   npx hardhat run scripts/arbitrum-sepolia-aave.js --network arbitrumSepolia
 *   ARBITRUM_SEPOLIA_AAVE_CHECK_ONLY=1  (balances + Aave position only)
 *
 * Env:
 *   ARBITRUM_SEPOLIA_AAVE_SUPPLY_ETH=0.001    WETH supplied as collateral
 *   ARBITRUM_SEPOLIA_AAVE_BORROW_USDC=0.1     USDC to borrow (6 decimals)
 *   ARBITRUM_SEPOLIA_AAVE_MIN_ETH=0.002       minimum native ETH to run
 *   ARBITRUM_SEPOLIA_AAVE_DRY_RUN=1           log only
 *   PREP_TX_DELAY_MS / TX_DELAY_MS            pause after each confirmed tx (default 10000)
 */

const hre = require("hardhat");
const { ethers } = hre;
const { waitAfterTx } = require("./lib/tx-delay");
require("dotenv").config();

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const VARIABLE_RATE_MODE = 2;

// Aave V3 Arbitrum Sepolia — bgd-labs/aave-address-book (AaveV3ArbitrumSepolia.sol)
const AAVE_POOL = "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff";
const WETH = "0x1dF462e2712496373A347f8ad10802a5E95f053D";
const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const WETH_A_TOKEN = "0xf5f17EbE81E516Dc7cB38D61908EC252F150CE60";

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
  return process.env.ARBITRUM_SEPOLIA_AAVE_CHECK_ONLY === "1";
}

function dryRun() {
  return process.env.ARBITRUM_SEPOLIA_AAVE_DRY_RUN === "1";
}

async function assertArbitrumSepolia(network) {
  if (Number(network.config.chainId) !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(`Use --network arbitrumSepolia (chain ${ARBITRUM_SEPOLIA_CHAIN_ID})`);
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
  await tx.wait();
  await waitAfterTx(`${label} approve`);
  return true;
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

  console.log("--- Arbitrum Sepolia Aave status ---");
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
  console.log("Explorer:     ", `https://sepolia.arbiscan.io/address/${address}`);
  console.log("------------------------------");

  return { address, ethBal, wethBal, usdcBal, aWethBal, account };
}

async function runAaveFlow(signer, status) {
  const supplyEth = process.env.ARBITRUM_SEPOLIA_AAVE_SUPPLY_ETH || "0.001";
  const borrowUsdc = process.env.ARBITRUM_SEPOLIA_AAVE_BORROW_USDC || "0.1";
  const minGasEth = process.env.ARBITRUM_SEPOLIA_AAVE_MIN_ETH || "0.001";

  const supplyWei = ethers.parseEther(supplyEth);
  const borrowUnits = ethers.parseUnits(borrowUsdc, 6);
  const minGasWei = ethers.parseEther(minGasEth);
  let txCount = 0;

  if (status.ethBal < minGasWei) {
    console.log(
      `\nNeed at least ${minGasEth} native ETH for gas (have ${ethers.formatEther(status.ethBal)}). Fund: https://www.alchemy.com/faucets/arbitrum-sepolia`
    );
    return { ok: false, txCount };
  }

  const address = status.address;
  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
  const pool = new ethers.Contract(AAVE_POOL, POOL_ABI, signer);
  const hasCollateral =
    status.aWethBal >= supplyWei ||
    (status.account && status.account[0] > 0n);

  console.log("\n=== Aave v3 Arbitrum Sepolia (supply → borrow → repay) ===");
  console.log(`Supply ${supplyEth} WETH | Borrow ${borrowUsdc} USDC`);

  // Step 1: Wrap ETH if needed
  let wethBal = await weth.balanceOf(address);
  if (!hasCollateral && wethBal < supplyWei) {
    const wrapAmount = supplyWei - wethBal;
    if (status.ethBal < wrapAmount) {
      console.log(
        `\nInsufficient native ETH to wrap ${ethers.formatEther(wrapAmount)} WETH (have ${ethers.formatEther(status.ethBal)} ETH).`
      );
      return { ok: false, txCount };
    }
    console.log(`\n[1] WETH deposit ${ethers.formatEther(wrapAmount)} ETH`);
    if (!dryRun()) {
      const tx = await weth.deposit({ value: wrapAmount });
      console.log("  tx:", tx.hash);
      await tx.wait();
      await waitAfterTx("WETH deposit");
      txCount += 1;
    }
    wethBal = await weth.balanceOf(address);
  } else {
    console.log("\n[1] Collateral/WETH sufficient — skip wrap");
  }

  // Step 2: Supply WETH
  if (!hasCollateral) {
    console.log(`\n[2] Supply ${supplyEth} WETH to Aave Pool`);
    await ensureAllowance(weth, address, AAVE_POOL, supplyWei, "WETH");
    if (!dryRun()) {
      const tx = await pool.supply(WETH, supplyWei, address, 0);
      console.log("  tx:", tx.hash);
      await tx.wait();
      await waitAfterTx("Aave supply");
      txCount += 1;
    }
  } else {
    console.log(`\n[2] Existing Aave collateral (${ethers.formatEther(status.aWethBal)} aWETH) — skip supply`);
  }

  // Step 3: Borrow USDC
  console.log(`\n[3] Borrow ${borrowUsdc} USDC (variable rate)`);
  if (!dryRun()) {
    const tx = await pool.borrow(USDC, borrowUnits, VARIABLE_RATE_MODE, 0, address);
    console.log("  tx:", tx.hash);
    await tx.wait();
    await waitAfterTx("Aave borrow");
    txCount += 1;
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
    await waitAfterTx("Aave repay");
    txCount += 1;
  }

  console.log("\n=== Aave flow complete ===");
  console.log(`Broadcast ${txCount} transaction(s) for wallet`, address);
  console.log("On-chain supply/borrow/repay events emitted for wallet", address);
  console.log("CredFlow indexer will pick these up via Alchemy transfers + receipt logs.");
  return { ok: true, txCount };
}

async function main() {
  await assertArbitrumSepolia(hre.network);
  const [signer] = await ethers.getSigners();
  const status = await printStatus(signer);

  if (checkOnly()) {
    console.log("\nARBITRUM_SEPOLIA_AAVE_CHECK_ONLY=1 — no transactions sent.");
    return;
  }

  const result = await runAaveFlow(signer, status);
  if (!result.ok) {
    process.exit(1);
  }
  if (!dryRun() && result.txCount === 0) {
    console.error("\nNo transactions were broadcast.");
    process.exit(1);
  }
  console.log("\n--- Post-flow status ---");
  await printStatus(signer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
