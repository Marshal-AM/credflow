#!/usr/bin/env node
/** Verify docs, frontend, and .env contract keys match canonical docs/*.json */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function envValue(envText, key) {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = envText.match(re);
  return m ? m[1].trim() : null;
}

function main() {
  const hub = readJson("docs/addresses.json");
  const arb = readJson("docs/spoke-arbitrum-addresses.json");
  const base = readJson("docs/spoke-base-addresses.json");
  const fhub = readJson("frontend/src/lib/addresses.json");
  const farb = readJson("frontend/src/lib/spoke-arbitrum-addresses.json");
  const fbase = readJson("frontend/src/lib/spoke-base-addresses.json");

  const pairs = [
    ["frontend hub", hub, fhub],
    ["frontend arbitrum", arb, farb],
    ["frontend base", base, fbase],
  ];

  let ok = true;
  for (const [label, a, b] of pairs) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      ok = false;
      console.error(`MISMATCH: ${label} docs vs frontend`);
    }
  }

  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("MISSING: .env");
    ok = false;
  } else {
    const env = fs.readFileSync(envPath, "utf8");
    const expected = {
      HUB_OAPP_ADDRESS: hub.oapp,
      CREDFLOW_LENDING_ADDRESS: hub.lending,
      CREDSCORE_SBT_ADDRESS: hub.sbt,
      SCORE_ENGINE_ADDRESS: hub.scoreEngine,
      PRICE_ORACLE: hub.oracle,
      ARBITRUM_OAPP_ADDRESS: arb.oapp,
      ARBITRUM_LENDING_ADDRESS: arb.lending,
      BASE_OAPP_ADDRESS: base.oapp,
      BASE_LENDING_ADDRESS: base.lending,
    };
    for (const [key, want] of Object.entries(expected)) {
      const got = envValue(env, key);
      if (!got) {
        ok = false;
        console.error(`MISSING .env key: ${key}`);
      } else if (got.toLowerCase() !== want.toLowerCase()) {
        ok = false;
        console.error(`MISMATCH .env ${key}: got ${got} expected ${want}`);
      }
    }
  }

  if (ok) {
    console.log("OK: docs, frontend, and .env contract keys are in sync");
    console.log("Hub SBT:", hub.sbt);
    console.log("Hub lending:", hub.lending);
    console.log("Arbitrum lending:", arb.lending);
    console.log("Base lending:", base.lending);
  } else {
    process.exit(1);
  }
}

main();
