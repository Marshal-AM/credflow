const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", "frontend", ".env") });

const ZERO = "0x0000000000000000000000000000000000000000";
const SCORE = 830;

async function main() {
  const hub = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8"));
  const arb = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "spoke-arbitrum-addresses.json"), "utf8")
  );
  const base = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "spoke-base-addresses.json"), "utf8")
  );
  const [agent] = await ethers.getSigners();

  const sbt = await ethers.getContractAt("CredScoreSBT", hub.sbt);
  const hubOapp = await ethers.getContractAt("CredFlowOApp", hub.oapp);

  console.log("Agent:", agent.address);
  console.log("Wallet:", ZERO);

  if (await sbt.isBlacklisted(ZERO)) {
    if (await sbt.hasProfile(ZERO)) {
      const tx = await sbt.whitelistWallet(ZERO);
      await tx.wait();
      console.log("hub_sbt whitelistWallet tx:", tx.hash);
    } else {
      const tx = await sbt.removeFromBlacklist(ZERO);
      await tx.wait();
      console.log("hub_sbt removeFromBlacklist tx:", tx.hash);
    }
  } else {
    console.log("hub_sbt: already clear");
  }

  if (await hubOapp.isBlacklisted(ZERO)) {
    const tx = await hubOapp.clearDefaultBlacklist(ZERO, SCORE);
    await tx.wait();
    console.log("hub_oapp clearDefaultBlacklist tx:", tx.hash);
  } else {
    console.log("hub_oapp: already clear");
  }

  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
  for (const [chain, spoke, rpc] of [
    [
      "arbitrum",
      arb,
      process.env.RPC_ARBITRUM_SEPOLIA || process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA,
    ],
    [
      "base",
      base,
      process.env.RPC_BASE_SEPOLIA ||
        process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
        process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA,
    ],
  ]) {
    if (!rpc) {
      console.log(`${chain}_oapp: rpc missing`);
      continue;
    }
    const provider = new ethers.JsonRpcProvider(rpc);
    const signer = new ethers.Wallet(pk, provider);
    const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp, signer);
    if (await oapp.isBlacklisted(ZERO)) {
      const tx = await oapp.clearDefaultBlacklist(ZERO, SCORE);
      await tx.wait();
      console.log(`${chain}_oapp clearDefaultBlacklist tx:`, tx.hash);
    } else {
      console.log(`${chain}_oapp: already clear`);
    }
  }

  console.log("--- verify ---");
  console.log("hub_sbt:", await sbt.isBlacklisted(ZERO));
  console.log("hub_oapp:", await hubOapp.isBlacklisted(ZERO));
  for (const [chain, spoke, rpc] of [
    [
      "arbitrum",
      arb,
      process.env.RPC_ARBITRUM_SEPOLIA || process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA,
    ],
    [
      "base",
      base,
      process.env.RPC_BASE_SEPOLIA ||
        process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
        process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA,
    ],
  ]) {
    if (!rpc) continue;
    const provider = new ethers.JsonRpcProvider(rpc);
    const oapp = await ethers.getContractAt("CredFlowOApp", spoke.oapp, provider);
    console.log(`${chain}_oapp:`, await oapp.isBlacklisted(ZERO));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
