const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ROOT = path.join(__dirname, "..", "..");
const spokeTokens = require(path.join(ROOT, "config", "spoke-tokens.json"));

const ABIS_TO_EXPORT = ["CredFlowSpokeLending", "ChainlinkOracle", "CredFlowLP"];

function loadSpokeConfig(spokeArg) {
  const key = (spokeArg || process.env.SPOKE || "arbitrum").toLowerCase();
  const cfg = spokeTokens[key];
  if (!cfg) {
    throw new Error(`Unknown spoke '${key}'. Use: arbitrum | base`);
  }
  const addressesPath = path.join(ROOT, "docs", cfg.addressFile);
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const feed =
    process.env[cfg.ethUsdFeedEnv] ||
    process.env.CHAINLINK_ETH_USD_FEED ||
    cfg.ethUsdFeed;
  return { key, cfg, addresses, addressesPath, feed };
}

function exportAbis(names) {
  const abisDir = path.join(ROOT, "docs", "abis");
  fs.mkdirSync(abisDir, { recursive: true });
  for (const name of names) {
    const artifactPath = path.join(ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
    if (!fs.existsSync(artifactPath)) continue;
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    fs.writeFileSync(path.join(abisDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
  }
}

module.exports = { loadSpokeConfig, exportAbis, ABIS_TO_EXPORT, spokeTokens, ROOT };
