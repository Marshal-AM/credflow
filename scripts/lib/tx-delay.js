/**
 * Pause between on-chain txs to avoid RPC "in-flight transaction limit" errors
 * (common with delegated / smart-account signers).
 *
 * Env: PREP_TX_DELAY_MS or TX_DELAY_MS (default 10000 ms)
 */

function txDelayMs() {
  return parseInt(
    process.env.PREP_TX_DELAY_MS || process.env.TX_DELAY_MS || "10000",
    10
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitAfterTx(label) {
  const ms = txDelayMs();
  if (ms <= 0) return;
  const suffix = label ? ` (${label})` : "";
  console.log(`  waiting ${ms}ms before next tx${suffix}...`);
  await sleep(ms);
}

module.exports = { txDelayMs, sleep, waitAfterTx };
