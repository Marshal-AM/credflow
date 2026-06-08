/**
 * Morpho Blue activity for CredFlow scoring data.
 * Chain: Base Sepolia (84532) only — Morpho Blue is not on Arbitrum Sepolia.
 * Flow: wrap ETH -> supplyCollateral WETH -> borrow USDC -> repay USDC -> withdrawCollateral WETH
 *
 * Usage:
 *   npx hardhat run scripts/morpho.js --network baseSepolia
 *   MORPHO_CHECK_ONLY=1  -> print balances & position only, no txns
 *   MORPHO_DRY_RUN=1     -> log steps only, no txns
 *
 * Env:
 *   MORPHO_SUPPLY_ETH=0.001
 *   MORPHO_BORROW_USDC=0.1
 *   MORPHO_MIN_ETH=0.002
 *   MORPHO_TX_DELAY_MS=5000
 *   MORPHO_SEED_USDC=1
 */

const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

const { MaxUint256, ZeroAddress, parseEther, parseUnits, formatEther, formatUnits, keccak256, AbiCoder, getAddress } = ethers;

const cs = (addr) => getAddress(addr.toLowerCase());
const zeroPad32 = () => ethers.zeroPadValue("0x00", 32);
const abiEncode = (types, values) => AbiCoder.defaultAbiCoder().encode(types, values);

// -- Chain IDs --
const BASE_SEPOLIA = 84532;

// -- Morpho Blue singleton --
const MORPHO_BLUE = cs("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb");

// -- Per-chain config --
// CL_ETH_USD: raw Chainlink AggregatorV3 ETH/USD feed.
// Used as baseFeed1 inside MorphoChainlinkOracleV2 (NOT passed to Morpho Blue directly).
const CHAIN_CONFIG = {
  [BASE_SEPOLIA]: {
    name:           "Base Sepolia",
    explorer:       "https://sepolia.basescan.org",
    faucet:         "https://www.alchemy.com/faucets/base-sepolia",
    ORACLE_FACTORY: cs("0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d"),
    WETH:           cs("0x4200000000000000000000000000000000000006"),
    USDC:           cs("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
    IRM:            cs("0x46415998764C29aB2a25CbeA6254146D50D22687"),
    LLTV:           "860000000000000000",
    CL_ETH_USD:     cs("0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"),
  },
};

// -- ABIs --
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const WETH_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
  "function withdraw(uint256 wad)",
];
const MORPHO_ABI = [
  "function supplyCollateral(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)",
  "function withdrawCollateral(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)",
  "function borrow(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)",
  "function repay(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)",
  "function supply(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function createMarket(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)",
  "function isIrmEnabled(address) view returns (bool)",
  "function isLltvEnabled(uint256) view returns (bool)",
];
const ORACLE_FACTORY_ABI = [
  "function createMorphoChainlinkOracleV2(address baseVault, uint256 baseVaultConversionSample, address baseFeed1, address baseFeed2, uint256 baseTokenDecimals, address quoteVault, uint256 quoteVaultConversionSample, address quoteFeed1, address quoteFeed2, uint256 quoteTokenDecimals, bytes32 salt) returns (address oracle)",
  "function isMorphoChainlinkOracleV2(address) view returns (bool)",
  "event CreateMorphoChainlinkOracleV2(address caller, address oracle)",
];
const ORACLE_ABI = [
  "function price() view returns (uint256)",
  "function BASE_FEED_1() view returns (address)",
  "function QUOTE_FEED_1() view returns (address)",
];
const CL_FEED_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

// -- Flags --
const checkOnly = () => process.env.MORPHO_CHECK_ONLY === "1";
const dryRun    = () => process.env.MORPHO_DRY_RUN    === "1";
const TX_DELAY  = parseInt(process.env.MORPHO_TX_DELAY_MS || "5000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAndWait(txPromise, label) {
  const tx = await txPromise;
  console.log("  [" + label + "] tx: " + tx.hash);
  const receipt = await tx.wait();
  console.log("  [" + label + "] confirmed in block " + receipt.blockNumber + " -- waiting " + TX_DELAY + "ms...");
  await sleep(TX_DELAY);
  return receipt;
}

// -- Market helpers --
function buildMarketParams(cfg, oracleAddress) {
  return {
    loanToken:       cfg.USDC,
    collateralToken: cfg.WETH,
    oracle:          oracleAddress,
    irm:             cfg.IRM,
    lltv:            BigInt(cfg.LLTV),
  };
}

function marketId(params) {
  return keccak256(
    abiEncode(
      ["address", "address", "address", "address", "uint256"],
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]
    )
  );
}

// -- Allowance helper --
async function ensureAllowance(token, owner, spender, amount, label) {
  const current = await token.allowance(owner, spender);
  if (current >= amount) {
    console.log("  " + label + " allowance already sufficient -- skipping approve");
    return;
  }
  console.log("  Approving " + label + " -> Morpho Blue");
  if (dryRun()) return;
  await sendAndWait(token.approve(spender, MaxUint256), "approve " + label);
}

// -- Oracle deploy / reuse --
const ORACLE_FACTORY_IFACE = new ethers.Interface(ORACLE_FACTORY_ABI);
const ORACLE_CREATED_TOPIC = ORACLE_FACTORY_IFACE.getEvent("CreateMorphoChainlinkOracleV2").topicHash;

// WETH collateral / USDC loan: ETH/USD on base side, USDC hardcoded to $1 (quote feeds = 0).
function oracleSalt(chainId) {
  return keccak256(abiEncode(["string", "uint256"], ["credflow-morpho-oracle-base", chainId]));
}

function oracleCreateArgs(cfg, chainId) {
  return [
    ZeroAddress, 1n,
    cfg.CL_ETH_USD,
    ZeroAddress,
    18n,
    ZeroAddress, 1n,
    ZeroAddress,
    ZeroAddress,
    6n,
    oracleSalt(chainId),
  ];
}

function parseOracleFromReceipt(receipt, factoryAddress) {
  const factory = factoryAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory) continue;
    if (log.topics[0] !== ORACLE_CREATED_TOPIC) continue;
    try {
      const parsed = ORACLE_FACTORY_IFACE.parseLog(log);
      return cs(parsed.args.oracle);
    } catch (_) {
      /* try next log */
    }
  }
  return null;
}

async function findOracleFromFactoryEvents(factory, signerAddr, fromBlock, toBlock) {
  const filter = factory.filters.CreateMorphoChainlinkOracleV2();
  const events = await factory.queryFilter(filter, fromBlock, toBlock);
  if (events.length === 0) return null;

  const ours = events.filter((e) => e.args.caller.toLowerCase() === signerAddr);
  const pick = ours.length > 0 ? ours[ours.length - 1] : events[events.length - 1];
  return cs(pick.args.oracle);
}

const LOG_CHUNK = 1999;

async function findOracleInRecentFactoryLogs(signerAddr, cfg, lookback = 300000) {
  const latest = await ethers.provider.getBlockNumber();
  const from = Math.max(0, latest - lookback);
  const candidates = [];

  for (let end = latest; end >= from; end -= LOG_CHUNK) {
    const start = Math.max(from, end - LOG_CHUNK + 1);
    const logs = await ethers.provider.getLogs({
      address: cfg.ORACLE_FACTORY,
      fromBlock: start,
      toBlock: end,
      topics: [ORACLE_CREATED_TOPIC],
    });
    for (const log of logs) {
      try {
        const parsed = ORACLE_FACTORY_IFACE.parseLog(log);
        if (parsed.args.caller.toLowerCase() !== signerAddr) continue;
        candidates.push(cs(parsed.args.oracle));
      } catch (_) {
        /* skip */
      }
    }
    if (candidates.length > 0) break;
  }

  const factory = new ethers.Contract(cfg.ORACLE_FACTORY, ORACLE_FACTORY_ABI, ethers.provider);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const addr = candidates[i];
    try {
      if (!(await factory.isMorphoChainlinkOracleV2(addr))) continue;
      const oracle = new ethers.Contract(addr, ORACLE_ABI, ethers.provider);
      const baseFeed = await oracle.BASE_FEED_1();
      if (baseFeed.toLowerCase() !== cfg.CL_ETH_USD.toLowerCase()) continue;
      const p = await oracle.price();
      if (p > 0n) return addr;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

async function verifyOraclePrice(oracleAddress, signer, retries = 5) {
  const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, signer);
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const p = await oracle.price();
      if (p === 0n) throw new Error("Oracle price() returned 0");
      return p;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await sleep(1500);
    }
  }
  throw new Error("Oracle at " + oracleAddress + " failed .price(): " + lastErr.message);
}

async function ensureOracle(signer, cfg, chainId) {
  console.log("\n[O] Ensuring MorphoChainlinkOracleV2 oracle exists");

  if (!cfg.ORACLE_FACTORY) {
    throw new Error("ORACLE_FACTORY is not configured for " + cfg.name);
  }

  const factoryCode = await ethers.provider.getCode(cfg.ORACLE_FACTORY);
  if (factoryCode === "0x") {
    throw new Error("ORACLE_FACTORY " + cfg.ORACLE_FACTORY + " has no bytecode on " + cfg.name);
  }

  const clFeed = new ethers.Contract(cfg.CL_ETH_USD, CL_FEED_ABI, signer);
  try {
    const rd       = await clFeed.latestRoundData();
    const decimals = await clFeed.decimals();
    const price    = parseFloat(formatUnits(rd.answer, decimals));
    const age      = Math.floor(Date.now() / 1000) - Number(rd.updatedAt);
    console.log("  Chainlink ETH/USD feed: $" + price.toFixed(2) + ", updated " + age + "s ago");
    if (rd.answer <= 0n) throw new Error("Feed answer is 0 or negative");
    if (age > 86400) console.warn("  WARNING: Feed is >24h old -- may be stale on testnet");
  } catch (e) {
    console.error("  WARNING: Chainlink feed read failed:", e.message);
  }

  const factory    = new ethers.Contract(cfg.ORACLE_FACTORY, ORACLE_FACTORY_ABI, signer);
  const createArgs = oracleCreateArgs(cfg, chainId);
  let oracleAddress = null;

  if (dryRun()) {
    oracleAddress = "0x0000000000000000000000000000000000000001";
    console.log("  [dry run] skipping oracle deploy");
    return oracleAddress;
  }

  const envOracle = process.env.MORPHO_ORACLE_ADDRESS;
  if (envOracle) {
    oracleAddress = cs(envOracle);
    console.log("  Using MORPHO_ORACLE_ADDRESS: " + oracleAddress);
  }

  if (!oracleAddress) {
    try {
      const predicted = cs(await factory.createMorphoChainlinkOracleV2.staticCall(...createArgs));
      const oracleCode = await ethers.provider.getCode(predicted);
      if (oracleCode !== "0x") {
        oracleAddress = predicted;
        console.log("  Reusing existing oracle (CREATE2): " + oracleAddress);
      }
    } catch (_) {
      const signerAddr = (await signer.getAddress()).toLowerCase();
      oracleAddress = await findOracleInRecentFactoryLogs(signerAddr, cfg);
      if (oracleAddress) {
        console.log("  Reusing oracle from factory logs: " + oracleAddress);
      }
    }
  }

  if (!oracleAddress) {
    console.log("  Deploying oracle via MorphoChainlinkOracleV2Factory...");
    try {
      const tx = await factory.createMorphoChainlinkOracleV2(...createArgs);
      console.log("  [deployOracle] tx: " + tx.hash);
      const receipt = await tx.wait();
      console.log("  [deployOracle] confirmed in block " + receipt.blockNumber + " -- waiting " + TX_DELAY + "ms...");
      await sleep(TX_DELAY);

      oracleAddress = parseOracleFromReceipt(receipt, cfg.ORACLE_FACTORY);
      if (!oracleAddress) {
        const signerAddr = (await signer.getAddress()).toLowerCase();
        oracleAddress = await findOracleFromFactoryEvents(
          factory,
          signerAddr,
          receipt.blockNumber,
          receipt.blockNumber
        );
      }
      if (!oracleAddress) {
        throw new Error(
          "Oracle deploy tx succeeded but no CreateMorphoChainlinkOracleV2 event found. " +
          "Check factory " + cfg.ORACLE_FACTORY + " on " + cfg.name
        );
      }
      console.log("  Oracle deployed at: " + oracleAddress);
    } catch (err) {
      const signerAddr = (await signer.getAddress()).toLowerCase();
      oracleAddress = await findOracleInRecentFactoryLogs(signerAddr, cfg);
      if (!oracleAddress) {
        throw new Error("Oracle deploy failed and no reusable oracle found: " + err.message);
      }
      console.log("  Reusing oracle after deploy collision: " + oracleAddress);
    }
  }

  const p = await verifyOraclePrice(oracleAddress, signer);
  console.log("  Oracle .price() = " + p.toString() + " (OK)");

  return oracleAddress;
}

// -- Status printer --
async function printStatus(signer, cfg, oracleAddress) {
  const address = await signer.getAddress();
  const ethBal  = await ethers.provider.getBalance(address);
  const weth    = new ethers.Contract(cfg.WETH, WETH_ABI, signer);
  const usdc    = new ethers.Contract(cfg.USDC, ERC20_ABI, signer);
  const morpho  = new ethers.Contract(MORPHO_BLUE, MORPHO_ABI, signer);

  const wethBal = await weth.balanceOf(address);
  const usdcBal = await usdc.balanceOf(address);

  console.log("\n--- " + cfg.name + " Morpho Blue status ---");
  console.log("Wallet:       " + address);
  console.log("ETH balance:  " + formatEther(ethBal) + " ETH");
  console.log("WETH balance: " + formatEther(wethBal) + " WETH");
  console.log("USDC balance: " + formatUnits(usdcBal, 6) + " USDC");

  if (oracleAddress) {
    const params = buildMarketParams(cfg, oracleAddress);
    const id     = marketId(params);
    console.log("Oracle:       " + oracleAddress);
    console.log("Market ID:    " + id);

    let pos = null;
    try { pos = await morpho.position(id, address); } catch (_) {}
    let mkt = null;
    try { mkt = await morpho.market(id); } catch (_) {}

    if (pos) {
      console.log("Collateral:   " + formatEther(pos.collateral) + " WETH");
      console.log("BorrowShares: " + pos.borrowShares.toString());
      console.log("SupplyShares: " + pos.supplyShares.toString());
    }
    if (mkt) {
      console.log("Mkt supply:   " + formatUnits(mkt.totalSupplyAssets, 6) + " USDC");
      console.log("Mkt borrow:   " + formatUnits(mkt.totalBorrowAssets, 6) + " USDC");
    }
  }

  console.log("Explorer:     " + cfg.explorer + "/address/" + address);
  console.log("------------------------------");

  return { address, ethBal, wethBal, usdcBal };
}

// -- Market existence check --
async function ensureMarketExists(morpho, params) {
  const id  = marketId(params);
  const mkt = await morpho.market(id);

  if (mkt.lastUpdate > 0n) {
    console.log("  Market already exists (OK)");
    return;
  }

  console.log("  Market does not exist -- creating...");
  const irmOk  = await morpho.isIrmEnabled(params.irm);
  const lltvOk = await morpho.isLltvEnabled(params.lltv);
  if (!irmOk)  throw new Error("IRM " + params.irm + " is not enabled");
  if (!lltvOk) throw new Error("LLTV " + params.lltv + " is not enabled");

  if (!dryRun()) {
    await sendAndWait(morpho.createMarket(params), "createMarket");
    console.log("  Market created (OK)");
  }
}

// -- Ensure market has USDC liquidity --
async function ensureMarketLiquidity(morpho, usdc, signer, cfg, params, borrowUnits) {
  const id        = marketId(params);
  const mkt       = await morpho.market(id);
  const available = mkt.totalSupplyAssets >= mkt.totalBorrowAssets
    ? mkt.totalSupplyAssets - mkt.totalBorrowAssets
    : 0n;

  if (available >= borrowUnits) {
    console.log("  Liquidity sufficient (" + formatUnits(available, 6) + " USDC available) (OK)");
    return;
  }

  const seedRaw = process.env.MORPHO_SEED_USDC || "1";
  const seedAmt = parseUnits(seedRaw, 6) > (borrowUnits * 110n) / 100n
    ? parseUnits(seedRaw, 6)
    : (borrowUnits * 110n) / 100n;

  const address = await signer.getAddress();
  const usdcBal = await usdc.balanceOf(address);

  console.log("\n[3.5] Seeding market with " + formatUnits(seedAmt, 6) + " USDC...");

  if (usdcBal < seedAmt) {
    throw new Error(
      "Not enough USDC. Have " + formatUnits(usdcBal, 6) +
      ", need " + formatUnits(seedAmt, 6) + ". Get testnet USDC from a faucet."
    );
  }

  if (!dryRun()) {
    await ensureAllowance(usdc, address, MORPHO_BLUE, seedAmt, "USDC-seed");
    await sendAndWait(morpho.supply(params, seedAmt, 0, address, "0x"), "supply-seed");
    console.log("  Seeded (OK)");
  }
}

// -- Main flow --
async function runMorphoFlow(signer, cfg, status, oracleAddress) {
  const supplyEth  = process.env.MORPHO_SUPPLY_ETH  || "0.001";
  const borrowUsdc = process.env.MORPHO_BORROW_USDC || "0.1";
  const minEth     = process.env.MORPHO_MIN_ETH     || "0.002";

  const supplyWei   = parseEther(supplyEth);
  const borrowUnits = parseUnits(borrowUsdc, 6);
  const minWei      = parseEther(minEth);

  if (status.ethBal < minWei) {
    console.log("\nNeed at least " + minEth + " ETH. Get it from: " + cfg.faucet);
    return false;
  }

  const address = status.address;
  const weth    = new ethers.Contract(cfg.WETH, WETH_ABI, signer);
  const usdc    = new ethers.Contract(cfg.USDC, ERC20_ABI, signer);
  const morpho  = new ethers.Contract(MORPHO_BLUE, MORPHO_ABI, signer);
  const params  = buildMarketParams(cfg, oracleAddress);

  console.log("\n" + "=".repeat(60));
  console.log("  Morpho Blue -- " + cfg.name);
  console.log("  Supply " + supplyEth + " WETH | Borrow " + borrowUsdc + " USDC");
  console.log("  Oracle: " + oracleAddress);
  console.log("  Market ID: " + marketId(params));
  console.log("=".repeat(60));

  // [0] Ensure market exists
  console.log("\n[0] Checking market exists");
  await ensureMarketExists(morpho, params);

  // [1] Wrap ETH -> WETH
  const wethBal = await weth.balanceOf(address);
  if (wethBal < supplyWei) {
    const wrapAmt = supplyWei - wethBal;
    console.log("\n[1] Wrapping " + formatEther(wrapAmt) + " ETH -> WETH");
    if (!dryRun()) {
      await sendAndWait(weth.deposit({ value: wrapAmt }), "WETH.deposit");
    }
  } else {
    console.log("\n[1] WETH sufficient (" + formatEther(wethBal) + ") -- skip wrap");
  }

  // [2] Approve WETH
  console.log("\n[2] Checking WETH allowance");
  if (!dryRun()) {
    await ensureAllowance(weth, address, MORPHO_BLUE, supplyWei, "WETH");
  }

  // [3] supplyCollateral
  console.log("\n[3] supplyCollateral -- " + supplyEth + " WETH");
  if (!dryRun()) {
    await sendAndWait(
      morpho.supplyCollateral(params, supplyWei, address, "0x"),
      "supplyCollateral"
    );
  }

  // [3.5] Ensure USDC liquidity
  console.log("\n[3.5] Checking market USDC liquidity");
  await ensureMarketLiquidity(morpho, usdc, signer, cfg, params, borrowUnits);

  // [4] borrow USDC
  console.log("\n[4] borrow -- " + borrowUsdc + " USDC");
  if (!dryRun()) {
    await sendAndWait(
      morpho.borrow(params, borrowUnits, 0, address, address),
      "borrow"
    );
  }

  const usdcAfterBorrow = await usdc.balanceOf(address);
  console.log("  USDC balance after borrow: " + formatUnits(usdcAfterBorrow, 6));

  // [5] Approve USDC for repay
  console.log("\n[5] Checking USDC allowance for repay");
  if (!dryRun()) {
    await ensureAllowance(usdc, address, MORPHO_BLUE, MaxUint256, "USDC");
  }

  // [6] repay full debt
  console.log("\n[6] repay -- full debt");
  if (!dryRun()) {
    const id  = marketId(params);
    const pos = await morpho.position(id, address);
    if (pos.borrowShares === 0n) {
      console.log("  No borrow shares -- nothing to repay");
    } else {
      console.log("  Repaying " + pos.borrowShares.toString() + " borrow shares");
      await sendAndWait(
        morpho.repay(params, 0, pos.borrowShares, address, "0x"),
        "repay"
      );
    }
  }

  // [7] withdrawCollateral
  console.log("\n[7] withdrawCollateral");
  if (!dryRun()) {
    const id  = marketId(params);
    const pos = await morpho.position(id, address);
    if (pos.collateral === 0n) {
      console.log("  No collateral -- nothing to withdraw");
    } else {
      console.log("  Withdrawing " + formatEther(pos.collateral) + " WETH");
      await sendAndWait(
        morpho.withdrawCollateral(params, pos.collateral, address, address),
        "withdrawCollateral"
      );
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Morpho Blue flow complete (OK)");
  console.log("  Wallet: " + address);
  console.log("  Events: SupplyCollateral / Borrow / Repay / WithdrawCollateral");
  console.log("=".repeat(60));
  return true;
}

// -- Entry point --
async function main() {
  const chainId = Number(hre.network.config.chainId);
  const cfg     = CHAIN_CONFIG[chainId];

  if (!cfg) {
    throw new Error(
      "Unsupported chain " + chainId + ".\n" +
      "Use --network baseSepolia (84532) — Morpho Blue is not on Arbitrum Sepolia"
    );
  }

  const [signer]      = await ethers.getSigners();
  const oracleAddress = await ensureOracle(signer, cfg, chainId);
  const status        = await printStatus(signer, cfg, oracleAddress);

  if (checkOnly()) {
    console.log("\nMORPHO_CHECK_ONLY=1 -- no transactions sent.");
    return;
  }

  const ok = await runMorphoFlow(signer, cfg, status, oracleAddress);
  if (!ok) return;

  console.log("\n--- Post-flow status ---");
  await printStatus(signer, cfg, oracleAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});