#!/usr/bin/env node
/**
 * Sync deployed contract addresses from docs/*.json into .env and frontend copies.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const lzConfig = require(path.join(ROOT, "layerzero", "config.json"));

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function upsertEnv(filePath, updates) {
  const abs = path.join(ROOT, filePath);
  let content = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === "") continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    content = re.test(content) ? content.replace(re, line) : content + (content.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  fs.writeFileSync(abs, content);
}

function copyToFrontend() {
  const pairs = [
    ["docs/addresses.json", "frontend/src/lib/addresses.json"],
    ["docs/spoke-arbitrum-addresses.json", "frontend/src/lib/spoke-arbitrum-addresses.json"],
    ["docs/spoke-base-addresses.json", "frontend/src/lib/spoke-base-addresses.json"],
  ];
  for (const [src, dest] of pairs) {
    fs.mkdirSync(path.dirname(path.join(ROOT, dest)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, dest));
  }
}

function enrichHubAddresses() {
  const hubPath = path.join(ROOT, "docs", "addresses.json");
  const hub = readJson("docs/addresses.json");
  hub.layerzero = {
    eid: lzConfig.robinhoodTestnet.eid,
    endpointV2: lzConfig.robinhoodTestnet.endpointV2,
  };
  fs.writeFileSync(hubPath, JSON.stringify(hub, null, 2) + "\n");
}

function main() {
  enrichHubAddresses();
  copyToFrontend();

  const hub = readJson("docs/addresses.json");
  const arbitrum = readJson("docs/spoke-arbitrum-addresses.json");
  const base = readJson("docs/spoke-base-addresses.json");

  const envUpdates = {
    HUB_OAPP_ADDRESS: hub.oapp,
    CREDFLOW_LENDING_ADDRESS: hub.lending,
    ARBITRUM_OAPP_ADDRESS: arbitrum.oapp,
    ARBITRUM_LENDING_ADDRESS: arbitrum.lending,
    BASE_OAPP_ADDRESS: base.oapp,
    BASE_LENDING_ADDRESS: base.lending,
    PRICE_ORACLE: hub.oracle,
    CREDSCORE_SBT_ADDRESS: hub.sbt,
    SCORE_ENGINE_ADDRESS: hub.scoreEngine,
  };

  upsertEnv(".env", envUpdates);
  console.log("Updated .env contract address keys");
  console.log("Hub OApp:", hub.oapp);
  console.log("Hub Lending:", hub.lending);
  console.log("Arbitrum OApp:", arbitrum.oapp);
  console.log("Arbitrum Lending:", arbitrum.lending);
  console.log("Base OApp:", base.oapp);
  console.log("Base Lending:", base.lending);
}

main();
