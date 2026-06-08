const { ethers, network } = require("hardhat");

const USDG = process.env.USDG_ROBINHOOD || "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const WETH = process.env.WETH_ROBINHOOD || "0x7943e237c7F95DA44E0301572D358911207852Fa";
const AGENT_WALLET = process.env.AGENT_WALLET_ADDRESS;

// Leave headroom on deployer wallet for LP deposit transfers (~50 USDG on fork)
const LENDING_POOL_FUND = ethers.parseUnits("40", 6);

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
  "function withdraw(uint256 wad)",
];

async function getSigners() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const borrower = signers[1] || signers[0];
  const agent =
    AGENT_WALLET && (await owner.getAddress()).toLowerCase() === AGENT_WALLET.toLowerCase()
      ? owner
      : owner;
  return { owner, agent, borrower };
}

async function wrapEth(signer, amount) {
  const weth = new ethers.Contract(WETH, WETH_ABI, signer);
  return weth.deposit({ value: amount });
}

async function deployCredFlowFixture(useMockOracle = true) {
  const { owner, agent, borrower } = await getSigners();

  let oracle;
  if (useMockOracle) {
    const MockOracle = await ethers.getContractFactory("MockPriceOracle");
    oracle = await MockOracle.deploy();
    await oracle.waitForDeployment();
    await oracle.setPrice(WETH, 3000n * 10n ** 6n, 18);
  } else {
    const Oracle = await ethers.getContractFactory("ChainlinkOracle");
    oracle = await Oracle.deploy(owner.address);
    await oracle.waitForDeployment();
    const feed = process.env.CHAINLINK_ETH_USD_FEED;
    if (feed) {
      await oracle.setPriceFeed(WETH, feed, 18);
    }
  }

  const SBT = await ethers.getContractFactory("CredScoreSBT");
  const sbt = await SBT.deploy(owner.address);
  await sbt.waitForDeployment();

  const Pool = await ethers.getContractFactory("CredFlowLP");
  const pool = await Pool.deploy(USDG);
  await pool.waitForDeployment();

  const Lending = await ethers.getContractFactory("CredFlowLending");
  const lending = await Lending.deploy(
    await sbt.getAddress(),
    await oracle.getAddress(),
    USDG,
    owner.address
  );
  await lending.waitForDeployment();

  await pool.setLendingContract(await lending.getAddress());
  await lending.setLiquidityPool(await pool.getAddress());

  const SCORER_ROLE = await sbt.SCORER_ROLE();
  const AGENT_ROLE_SBT = await sbt.AGENT_ROLE();
  const AGENT_ROLE_LENDING = await lending.AGENT_ROLE();

  const agentAddress = await agent.getAddress();
  await sbt.grantRole(SCORER_ROLE, agentAddress);
  await sbt.grantRole(AGENT_ROLE_SBT, agentAddress);
  await sbt.grantRole(AGENT_ROLE_SBT, await lending.getAddress());
  await lending.grantRole(AGENT_ROLE_LENDING, agentAddress);

  return { owner, agent, borrower, sbt, pool, lending, oracle };
}

/** Deploy + fund lending pool — shared snapshot for lending and LP tests */
async function credFlowFundedFixture() {
  const f = await deployCredFlowFixture(true);
  await fundLendingWithUSDG(f.lending, LENDING_POOL_FUND);
  return f;
}

/** Transfer real USDG from deployer wallet (forked chain state) into lending */
async function fundLendingWithUSDG(lending, amount) {
  const [owner] = await ethers.getSigners();
  const usdg = new ethers.Contract(USDG, ERC20_ABI, owner);
  const bal = await usdg.balanceOf(owner.address);
  if (bal < amount) {
    throw new Error(
      `Deployer USDG insufficient: have ${ethers.formatUnits(bal, 6)}, need ${ethers.formatUnits(amount, 6)}`
    );
  }
  await (await usdg.transfer(await lending.getAddress(), amount)).wait();
  return true;
}

/** Send USDG from deployer wallet to another test account */
async function transferUSDGTo(to, amount) {
  const [owner] = await ethers.getSigners();
  const usdg = new ethers.Contract(USDG, ERC20_ABI, owner);
  const bal = await usdg.balanceOf(owner.address);
  if (bal < amount) {
    throw new Error(
      `Deployer USDG insufficient for transfer: have ${ethers.formatUnits(bal, 6)}, need ${ethers.formatUnits(amount, 6)}`
    );
  }
  await (await usdg.transfer(to, amount)).wait();
}

module.exports = {
  USDG,
  WETH,
  ERC20_ABI,
  WETH_ABI,
  LENDING_POOL_FUND,
  getSigners,
  wrapEth,
  deployCredFlowFixture,
  credFlowFundedFixture,
  fundLendingWithUSDG,
  transferUSDGTo,
};
