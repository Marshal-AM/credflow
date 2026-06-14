const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { loadSpokeConfig } = require("./lib/spoke-config");

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function tokenBalance(token, wallet) {
  const c = await ethers.getContractAt(ERC20, token);
  const [bal, symbol, decimals] = await Promise.all([
    c.balanceOf(wallet),
    c.symbol().catch(() => "?"),
    c.decimals().catch(() => 6),
  ]);
  return { bal, symbol, decimals, formatted: ethers.formatUnits(bal, decimals) };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  console.log("\n===", network, "===");
  console.log("Deployer:", deployer.address);

  const ethBal = await ethers.provider.getBalance(deployer.address);
  console.log("ETH:", ethers.formatEther(ethBal));

  if (network === "robinhoodTestnet") {
    const hub = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
    );
    const deployerTok = await tokenBalance(hub.usdg, deployer.address);
    const lendingTok = await tokenBalance(hub.usdg, hub.lending);
    console.log(`Deployer ${deployerTok.symbol}:`, deployerTok.formatted);
    console.log(`Lending ${lendingTok.symbol}:`, lendingTok.formatted);
    console.log("Lending contract:", hub.lending);
    return;
  }

  const spokeKey = network === "arbitrumSepolia" ? "arbitrum" : network === "baseSepolia" ? "base" : null;
  if (!spokeKey) {
    console.log("(not a hub or spoke network — skip)");
    return;
  }

  process.env.SPOKE = spokeKey;
  const { cfg, addresses } = loadSpokeConfig();
  const deployerTok = await tokenBalance(cfg.usdc, deployer.address);
  const lendingTok = addresses.lending
    ? await tokenBalance(cfg.usdc, addresses.lending)
    : null;

  console.log(`Deployer ${deployerTok.symbol}:`, deployerTok.formatted);
  if (lendingTok) {
    console.log(`Lending ${lendingTok.symbol}:`, lendingTok.formatted);
    console.log("Lending contract:", addresses.lending);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
