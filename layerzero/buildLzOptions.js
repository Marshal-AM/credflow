/**
 * Encode LayerZero executor options for OApp _lzSend calls.
 * Uses @layerzerolabs/lz-v2-utilities (official Options builder).
 * @param {number} gasLimit - lzReceive gas on destination (default 200000)
 * @returns {string} hex bytes (no 0x prefix)
 */
function buildLzOptions(gasLimit = 200000) {
  const { Options } = require("@layerzerolabs/lz-v2-utilities");
  return Options.newOptions().addExecutorLzReceiveOption(gasLimit, 0).toHex().replace(/^0x/, "");
}

module.exports = { buildLzOptions };
