const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const DEFAULT_USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const DEFAULT_WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";

const ABIS_TO_EXPORT = [
  "CredScoreSBT",
  "CredScoreEngine",
  "CredFlowLending",
  "CredFlowOApp",
  "CredFlowLP",
  "ChainlinkOracle",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const usdgAddress = process.env.USDG_ROBINHOOD || DEFAULT_USDG;
  const wethAddress = process.env.WETH_ROBINHOOD || DEFAULT_WETH;
  const agentWallet = process.env.AGENT_WALLET_ADDRESS || deployer.address;
  const ethUsdFeed = process.env.CHAINLINK_ETH_USD_FEED;
  const lzConfig = require("../layerzero/config.json");
  const lzEndpoint =
    process.env.LAYERZERO_ENDPOINT_ROBINHOOD || lzConfig.robinhoodTestnet.endpointV2;

  // 1. Oracle
  const Oracle = await ethers.getContractFactory("ChainlinkOracle");
  const oracle = await Oracle.deploy(deployer.address);
  await oracle.waitForDeployment();
  console.log("ChainlinkOracle:", await oracle.getAddress());

  if (ethUsdFeed) {
    const tx = await oracle.setPriceFeed(wethAddress, ethUsdFeed, 18);
    await tx.wait();
    console.log("WETH price feed set:", ethUsdFeed);
  } else {
    console.warn("CHAINLINK_ETH_USD_FEED not set — configure WETH feed after deploy");
  }

  // 2. SBT
  const SBT = await ethers.getContractFactory("CredScoreSBT");
  const sbt = await SBT.deploy(deployer.address);
  await sbt.waitForDeployment();
  console.log("CredScoreSBT:", await sbt.getAddress());

  // 2b. CredScore engine (on-chain formula + Reclaim balance capacity)
  const Engine = await ethers.getContractFactory("CredScoreEngine");
  const scoreEngine = await Engine.deploy(await sbt.getAddress(), deployer.address);
  await scoreEngine.waitForDeployment();
  console.log("CredScoreEngine:", await scoreEngine.getAddress());

  // 3. Liquidity pool
  const Pool = await ethers.getContractFactory("CredFlowLP");
  const pool = await Pool.deploy(usdgAddress);
  await pool.waitForDeployment();
  console.log("CredFlowLP:", await pool.getAddress());

  // 4. Lending
  const Lending = await ethers.getContractFactory("CredFlowLending");
  const lending = await Lending.deploy(
    await sbt.getAddress(),
    await oracle.getAddress(),
    usdgAddress,
    deployer.address
  );
  await lending.waitForDeployment();
  console.log("CredFlowLending:", await lending.getAddress());

  // 5. OApp (optional without LayerZero endpoint)
  let oappAddress = ethers.ZeroAddress;
  if (lzEndpoint) {
    const OApp = await ethers.getContractFactory("CredFlowOApp");
    const oapp = await OApp.deploy(lzEndpoint, await sbt.getAddress(), deployer.address);
    await oapp.waitForDeployment();
    oappAddress = await oapp.getAddress();
    console.log("CredFlowOApp:", oappAddress);
  } else {
    console.warn("LAYERZERO_ENDPOINT_ROBINHOOD not set — skipping OApp deploy");
  }

  // Wire pool ↔ lending
  await (await pool.setLendingContract(await lending.getAddress())).wait();
  await (await lending.setLiquidityPool(await pool.getAddress())).wait();

  // Role grants
  const SCORER_ROLE = await sbt.SCORER_ROLE();
  const AGENT_ROLE_SBT = await sbt.AGENT_ROLE();
  const AGENT_ROLE_LENDING = await lending.AGENT_ROLE();

  const ENGINE_SCORER_ROLE = await scoreEngine.SCORER_ROLE();
  await (await sbt.grantRole(SCORER_ROLE, await scoreEngine.getAddress())).wait();
  await (await scoreEngine.grantRole(ENGINE_SCORER_ROLE, agentWallet)).wait();
  await (await sbt.grantRole(SCORER_ROLE, agentWallet)).wait();
  await (await sbt.grantRole(AGENT_ROLE_SBT, agentWallet)).wait();
  await (await sbt.grantRole(AGENT_ROLE_SBT, await lending.getAddress())).wait();
  await (await lending.grantRole(AGENT_ROLE_LENDING, agentWallet)).wait();

  if (oappAddress !== ethers.ZeroAddress) {
    const oapp = await ethers.getContractAt("CredFlowOApp", oappAddress);
    await (await oapp.grantRole(await oapp.AGENT_ROLE(), agentWallet)).wait();
  }

  // Fund lending with USDG
  const fundAmount = ethers.parseUnits(process.env.LENDING_FUND_USDG || "10000", 6);
  const usdg = await ethers.getContractAt(
    ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"],
    usdgAddress
  );
  const deployerBalance = await usdg.balanceOf(deployer.address);
  if (deployerBalance >= fundAmount) {
    await (await usdg.transfer(await lending.getAddress(), fundAmount)).wait();
    console.log("Funded lending with", ethers.formatUnits(fundAmount, 6), "USDG");
  } else {
    console.warn(
      "Deployer USDG balance insufficient to fund lending.",
      "Have:", ethers.formatUnits(deployerBalance, 6),
      "Need:", ethers.formatUnits(fundAmount, 6)
    );
  }

  const addresses = {
    sbt: await sbt.getAddress(),
    scoreEngine: await scoreEngine.getAddress(),
    lending: await lending.getAddress(),
    pool: await pool.getAddress(),
    oapp: oappAddress,
    oracle: await oracle.getAddress(),
    usdg: usdgAddress,
    weth: wethAddress,
    chainId: 46630,
  };

  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "addresses.json"), JSON.stringify(addresses, null, 2));
  console.log("Saved docs/addresses.json");

  const abisDir = path.join(docsDir, "abis");
  fs.mkdirSync(abisDir, { recursive: true });

  for (const name of ABIS_TO_EXPORT) {
    const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
    if (fs.existsSync(artifactPath)) {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      fs.writeFileSync(path.join(abisDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
    }
  }

  const frontendLib = path.join(__dirname, "..", "frontend", "src", "lib");
  fs.mkdirSync(frontendLib, { recursive: true });
  fs.copyFileSync(path.join(docsDir, "addresses.json"), path.join(frontendLib, "addresses.json"));
  console.log("ABIs exported to docs/abis/ and addresses copied to frontend/lib/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
