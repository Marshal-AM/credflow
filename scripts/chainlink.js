/**
 * Chainlink ETH/USD — reads live mainnet feeds (Arbitrum One + Base Mainnet).
 * Spoke oracles mirror these prices on-chain via scripts/sync-spoke-oracle.js.
 *
 * Usage:
 *   node scripts/chainlink.js
 *   node scripts/chainlink.js arbitrum
 *   node scripts/chainlink.js base
 */

const { NETWORKS, fetchPrice } = require("./lib/chainlink-price");

function printResult(r) {
  const priceStr = `$${r.price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  console.log(`
┌─────────────────────────────────────────────────────┐
│  ${r.network.padEnd(51)}│
├─────────────────────────────────────────────────────┤
│  Feed     : ${r.feed.padEnd(39)}│
│  Price    : ${priceStr.padEnd(39)}│
│  Updated  : ${r.updatedAt.padEnd(39)}│
│  Age      : ${(r.ageSeconds + "s ago").padEnd(39)}│
│  Round ID : ${r.roundId.padEnd(39)}│
│  Address  : ${r.address.padEnd(39)}│
└─────────────────────────────────────────────────────┘`);

  if (r.isStale) {
    console.log(`  WARNING: Feed is ${Math.round(r.ageSeconds / 60)} min old — may be stale!\n`);
  }
}

async function main() {
  const arg = process.argv[2];
  const targets = arg ? [arg] : Object.keys(NETWORKS);

  console.log(`\nChainlink ETH/USD — Mainnet`);
  console.log(`   Networks: ${targets.join(", ")}\n`);

  const results = await Promise.allSettled(targets.map(fetchPrice));

  for (let i = 0; i < results.length; i++) {
    const outcome = results[i];
    if (outcome.status === "fulfilled") {
      printResult(outcome.value);
    } else {
      console.error(`\n  ${targets[i]}: ${outcome.reason?.message ?? outcome.reason}`);
    }
  }

  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (ok.length === 2) {
    const diff = Math.abs(ok[0].price - ok[1].price);
    console.log(`\nPrice spread between networks: $${diff.toFixed(4)}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("\nFatal:", err.message);
    process.exit(1);
  });
}

module.exports = { fetchPrice, NETWORKS, printResult };
