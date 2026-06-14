const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const lzConfig = require("../layerzero/config.json");

const SPOKE_KEYS = {
  arbitrum: "arbitrumSepolia",
  base: "baseSepolia",
};

async function main() {
  const spokeArg = (process.env.SPOKE || "arbitrum").toLowerCase();
  const configKey = SPOKE_KEYS[spokeArg];
  if (!configKey) {
    throw new Error(`Unknown spoke '${spokeArg}'. Use: arbitrum | base`);
  }

  const spokeCfg = lzConfig[configKey];
  const endpoint =
    process.env[`LAYERZERO_ENDPOINT_${spokeArg.toUpperCase()}`] || spokeCfg.endpointV2;

  const [deployer] = await ethers.getSigners();
  console.log("Spoke:", spokeArg);
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("EndpointV2:", endpoint);
  console.log("EID:", spokeCfg.eid);

  const OApp = await ethers.getContractFactory("CredFlowOApp");
  const oapp = await OApp.deploy(endpoint, ethers.ZeroAddress, deployer.address);
  await oapp.waitForDeployment();
  const oappAddress = await oapp.getAddress();
  console.log("CredFlowOApp (spoke):", oappAddress);

  const outPath = path.join(__dirname, "..", "docs", `spoke-${spokeArg}-addresses.json`);
  const payload = {
    chain: spokeArg,
    eid: spokeCfg.eid,
    endpointV2: endpoint,
    oapp: oappAddress,
    sbt: ethers.ZeroAddress,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Saved", outPath);

  const frontendPath = path.join(__dirname, "..", "frontend", "src", "lib", `spoke-${spokeArg}-addresses.json`);
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.copyFileSync(outPath, frontendPath);

  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await (await oapp.grantRole(await oapp.AGENT_ROLE(), agentWallet)).wait();
      console.log("Granted AGENT_ROLE to", agentWallet);
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      console.log(`AGENT_ROLE grant retry ${attempt}/5...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log(`Set ARBITRUM_OAPP_ADDRESS or BASE_OAPP_ADDRESS=${oappAddress} in .env, then run set-peers.js`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
