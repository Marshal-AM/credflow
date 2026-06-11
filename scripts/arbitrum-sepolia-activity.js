/**
 * Arbitrum Sepolia wallet activity for CredFlow scoring data.
 *
 * Phase 1.2 (scoring-data-todo.md):
 *   - Check ETH balance
 *   - Send 3 outbound transfers to distinct recipients (Dune protocol_diversity)
 *   - Optional 4th tx: tiny WETH deposit (contract interaction)
 *
 * Usage:
 *   npx hardhat run scripts/arbitrum-sepolia-activity.js --network arbitrumSepolia
 *   ARBITRUM_SEPOLIA_CHECK_ONLY=1           balance check only, no txs
 *
 * Env:
 *   ARBITRUM_SEPOLIA_TRANSFER_ETH=0.00001   ETH per transfer
 *   ARBITRUM_SEPOLIA_MIN_ETH=0.0005         minimum balance to run txs
 *   ARBITRUM_SEPOLIA_WETH_DEPOSIT_ETH=0.00001 optional WETH deposit (tx 4)
 *   ARBITRUM_SEPOLIA_DRY_RUN=1              log only, no broadcasts
 *   PREP_TX_DELAY_MS / TX_DELAY_MS          pause after each confirmed tx (default 10000)
 */

const hre = require("hardhat");
const { ethers } = hre;
const { waitAfterTx } = require("./lib/tx-delay");
require("dotenv").config();

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

const WETH_ARBITRUM_SEPOLIA = "0x1dF462e2712496373A347f8ad10802a5E95f053D";

const WETH_ABI = [
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
];

const DEFAULT_RECIPIENTS = [
  process.env.ARBITRUM_SEPOLIA_RECIPIENT_A || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  process.env.ARBITRUM_SEPOLIA_RECIPIENT_B || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  process.env.ARBITRUM_SEPOLIA_RECIPIENT_C || "0x000000000000000000000000000000000000dEaD",
];

function checkOnlyFlag() {
  return process.env.ARBITRUM_SEPOLIA_CHECK_ONLY === "1";
}

async function assertArbitrumSepolia(network) {
  const chainId = Number(network.config.chainId);
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Wrong network: chainId ${chainId}. Run with --network arbitrumSepolia (expected ${ARBITRUM_SEPOLIA_CHAIN_ID}).`
    );
  }
}

async function checkBalance(signer) {
  const address = await signer.getAddress();
  const balance = await ethers.provider.getBalance(address);
  const block = await ethers.provider.getBlock("latest");

  console.log("--- Arbitrum Sepolia balance check ---");
  console.log("Chain ID:     ", ARBITRUM_SEPOLIA_CHAIN_ID);
  console.log("RPC:          ", hre.network.config.url);
  console.log("Wallet:       ", address);
  console.log("ETH balance:  ", ethers.formatEther(balance), "ETH");
  console.log("Block:        ", block.number);
  console.log("--------------------------------------");

  return { address, balance };
}

async function sendTransfer(signer, to, label, valueWei) {
  console.log(`\n[${label}] ${ethers.formatEther(valueWei)} ETH -> ${to}`);
  if (process.env.ARBITRUM_SEPOLIA_DRY_RUN === "1") {
    console.log("  (dry run — skipped)");
    return null;
  }

  const tx = await signer.sendTransaction({ to, value: valueWei });
  console.log("  tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("  confirmed in block", receipt.blockNumber);
  await waitAfterTx(label);
  return receipt;
}

async function depositWeth(signer, valueWei) {
  console.log(`\n[Tx 4] WETH deposit ${ethers.formatEther(valueWei)} ETH at ${WETH_ARBITRUM_SEPOLIA}`);
  if (process.env.ARBITRUM_SEPOLIA_DRY_RUN === "1") {
    console.log("  (dry run — skipped)");
    return null;
  }

  const weth = new ethers.Contract(WETH_ARBITRUM_SEPOLIA, WETH_ABI, signer);
  const code = await ethers.provider.getCode(WETH_ARBITRUM_SEPOLIA);
  if (code === "0x") {
    console.log("  WETH contract not deployed on this RPC — skipping tx 4");
    return null;
  }

  const tx = await weth.deposit({ value: valueWei });
  console.log("  tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("  confirmed in block", receipt.blockNumber);
  await waitAfterTx("WETH deposit");
  return receipt;
}

async function runWalletActivity(signer, balance) {
  const minEth = process.env.ARBITRUM_SEPOLIA_MIN_ETH || "0.0005";
  const transferEth = process.env.ARBITRUM_SEPOLIA_TRANSFER_ETH || "0.00001";
  const wethDepositEth = process.env.ARBITRUM_SEPOLIA_WETH_DEPOSIT_ETH || "0.00001";

  const minWei = ethers.parseEther(minEth);
  const transferWei = ethers.parseEther(transferEth);
  const wethDepositWei = ethers.parseEther(wethDepositEth);

  const estimatedCost = transferWei * BigInt(DEFAULT_RECIPIENTS.length) + wethDepositWei;
  if (balance < minWei) {
    console.log("\nInsufficient balance to run activity txs.");
    console.log(`Need at least ${minEth} ETH. Fund via:`);
    console.log("  https://www.alchemy.com/faucets/arbitrum-sepolia");
    console.log("  https://faucet.quicknode.com/arbitrum/sepolia");
    return false;
  }

  if (balance < estimatedCost) {
    console.log(
      `\nWarning: balance (${ethers.formatEther(balance)} ETH) may be tight for all txs (est. ${ethers.formatEther(estimatedCost)} ETH + gas).`
    );
  }

  console.log("\n=== Arbitrum Sepolia wallet activity (Phase 1.2) ===");

  const receipts = [];
  for (let i = 0; i < DEFAULT_RECIPIENTS.length; i++) {
    const receipt = await sendTransfer(
      signer,
      DEFAULT_RECIPIENTS[i],
      `Tx ${i + 1}`,
      transferWei
    );
    if (receipt) receipts.push(receipt);
  }

  const wethReceipt = await depositWeth(signer, wethDepositWei);
  if (wethReceipt) receipts.push(wethReceipt);

  console.log("\n=== Done ===");
  console.log(`Broadcast ${receipts.length} tx(s) from`, await signer.getAddress());
  return true;
}

async function main() {
  await assertArbitrumSepolia(hre.network);
  const [signer] = await ethers.getSigners();
  const { balance } = await checkBalance(signer);

  if (checkOnlyFlag()) {
    console.log("\n--check-only: no transactions sent.");
    return;
  }

  const ok = await runWalletActivity(signer, balance);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
