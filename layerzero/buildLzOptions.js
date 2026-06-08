/**
 * Encode LayerZero executor options for OApp _lzSend calls.
 * Type 3 options = executor gas limit option.
 * @param {number} gasLimit - lzReceive gas on destination (default 200000)
 * @returns {string} hex bytes
 */
function buildLzOptions(gasLimit = 200000) {
  const optionType = Buffer.from([0x00, 0x03]);
  const execOption = Buffer.from([0x01]);
  const gasBytes = Buffer.alloc(16);
  gasBytes.writeBigUInt64BE(BigInt(gasLimit), 8);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(execOption.length + gasBytes.length);
  return Buffer.concat([optionType, length, execOption, gasBytes]).toString("hex");
}

module.exports = { buildLzOptions };
