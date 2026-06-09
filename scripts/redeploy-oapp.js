const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const lzConfig = require("../layerzero/config.json");

async function main() {
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();
  console.log("Redeploy hub OApp — network:", network);
  console.log("Deployer:", deployer.address);

  const addressesPath = path.join(__dirname, "..", "docs", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const endpoint =
    process.env.LAYERZERO_ENDPOINT_ROBINHOOD || lzConfig.robinhoodTestnet.endpointV2;
  const sbtAddress = addresses.sbt;
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  if (!sbtAddress) throw new Error("CredScoreSBT missing from docs/addresses.json");

  const OApp = await ethers.getContractFactory("CredFlowOApp");
  const oapp = await OApp.deploy(endpoint, sbtAddress, deployer.address);
  await oapp.waitForDeployment();
  const oappAddress = await oapp.getAddress();
  console.log("New CredFlowOApp (hub):", oappAddress);

  await (await oapp.grantRole(await oapp.AGENT_ROLE(), agentWallet)).wait();
  console.log("AGENT_ROLE granted to:", agentWallet);

  addresses.oapp = oappAddress;
  addresses.layerzero = {
    eid: lzConfig.robinhoodTestnet.eid,
    endpointV2: endpoint,
  };
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));

  const frontendLib = path.join(__dirname, "..", "frontend", "src", "lib", "addresses.json");
  if (fs.existsSync(path.dirname(frontendLib))) {
    fs.copyFileSync(addressesPath, frontendLib);
  }

  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "CredFlowOApp.sol",
    "CredFlowOApp.json"
  );
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abisDir = path.join(__dirname, "..", "docs", "abis");
    fs.mkdirSync(abisDir, { recursive: true });
    fs.writeFileSync(path.join(abisDir, "CredFlowOApp.json"), JSON.stringify(artifact.abi, null, 2));
  }

  console.log("\nUpdate .env HUB_OAPP_ADDRESS=" + oappAddress);
  console.log("Then: npm run deploy:spoke:arbitrum && npm run deploy:spoke:base");
  console.log("Then: npm run lz:wire-spokes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
