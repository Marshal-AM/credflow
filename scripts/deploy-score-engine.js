/**
 * Deploy CredScoreEngine against an existing CredScoreSBT (Robinhood testnet upgrade).
 *
 *   npx hardhat run scripts/deploy-score-engine.js --network robinhoodTestnet
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const addressesPath = path.join(__dirname, "..", "docs", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  if (!addresses.sbt) {
    throw new Error("docs/addresses.json missing sbt address");
  }

  const Engine = await ethers.getContractFactory("CredScoreEngine");
  const engine = await Engine.deploy(addresses.sbt, deployer.address);
  await engine.waitForDeployment();
  const engineAddress = await engine.getAddress();
  console.log("CredScoreEngine:", engineAddress);

  const sbt = await ethers.getContractAt("CredScoreSBT", addresses.sbt);
  const SCORER_ROLE = await sbt.SCORER_ROLE();
  const ENGINE_SCORER = await engine.SCORER_ROLE();

  await (await sbt.grantRole(SCORER_ROLE, engineAddress)).wait();
  await (await engine.grantRole(ENGINE_SCORER, agentWallet)).wait();
  console.log("Granted SCORER_ROLE on SBT to engine and on engine to", agentWallet);

  addresses.scoreEngine = engineAddress;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log("Updated docs/addresses.json");

  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "CredScoreEngine.sol",
    "CredScoreEngine.json"
  );
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abisDir = path.join(__dirname, "..", "docs", "abis");
    fs.mkdirSync(abisDir, { recursive: true });
    fs.writeFileSync(
      path.join(abisDir, "CredScoreEngine.json"),
      JSON.stringify(artifact.abi, null, 2)
    );
    console.log("Exported docs/abis/CredScoreEngine.json");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
