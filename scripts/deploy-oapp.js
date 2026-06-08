const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const lzConfig = require("../layerzero/config.json");

async function main() {
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();
  console.log("Network:", network);
  console.log("Deployer:", deployer.address);

  const addressesPath = path.join(__dirname, "..", "docs", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const endpoint =
    process.env.LAYERZERO_ENDPOINT_ROBINHOOD ||
    lzConfig.robinhoodTestnet.endpointV2;

  if (!endpoint || endpoint === ethers.ZeroAddress) {
    throw new Error("Set LAYERZERO_ENDPOINT_ROBINHOOD or layerzero/config.json endpointV2");
  }

  const sbtAddress = addresses.sbt;
  if (!sbtAddress || sbtAddress === ethers.ZeroAddress) {
    throw new Error("CredScoreSBT not in docs/addresses.json — run deploy.js first");
  }

  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;

  console.log("LayerZero EndpointV2:", endpoint);
  console.log("CredScoreSBT:", sbtAddress);

  const OApp = await ethers.getContractFactory("CredFlowOApp");
  const oapp = await OApp.deploy(endpoint, sbtAddress, deployer.address);
  await oapp.waitForDeployment();
  const oappAddress = await oapp.getAddress();
  console.log("CredFlowOApp:", oappAddress);

  const AGENT_ROLE = await oapp.AGENT_ROLE();
  await (await oapp.grantRole(AGENT_ROLE, agentWallet)).wait();
  console.log("AGENT_ROLE granted to:", agentWallet);

  addresses.oapp = oappAddress;
  addresses.layerzero = {
    eid: lzConfig.robinhoodTestnet.eid,
    endpointV2: endpoint,
  };

  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));

  const frontendLib = path.join(__dirname, "..", "frontend", "src", "lib", "addresses.json");
  fs.mkdirSync(path.dirname(frontendLib), { recursive: true });
  fs.copyFileSync(addressesPath, frontendLib);

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
    fs.writeFileSync(
      path.join(abisDir, "CredFlowOApp.json"),
      JSON.stringify(artifact.abi, null, 2)
    );
  }

  console.log("Updated docs/addresses.json and frontend/src/lib/addresses.json");
  console.log("Next: deploy spokes on Arbitrum/Base Sepolia, then run scripts/set-peers.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
