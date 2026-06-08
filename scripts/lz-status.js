const { ethers } = require("ethers");
const lzConfig = require("../layerzero/config.json");
require("dotenv").config();

async function checkChain(name, rpc, cfg) {
  if (!rpc) {
    console.log(`[${name}] SKIP — RPC not set`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  const endpoint = cfg.endpointV2;
  const code = await provider.getCode(endpoint);

  console.log(`\n[${name}]`);
  console.log("  chainId:", network.chainId.toString(), cfg.chainId ? `(expected ${cfg.chainId})` : "");
  console.log("  eid:", cfg.eid);
  console.log("  endpointV2:", endpoint);
  console.log("  deployed:", code !== "0x" ? `yes (${(code.length - 2) / 2} bytes)` : "NO — missing bytecode");
}

async function main() {
  console.log("LayerZero infrastructure status\n");
  console.log("Robinhood testnet is officially supported by LayerZero (eid 40451).");
  console.log("Self-deploying EndpointV2 is only needed for unsupported chains.\n");

  await checkChain(
    "robinhood-testnet",
    process.env.RPC_ROBINHOOD || "https://rpc.testnet.chain.robinhood.com",
    lzConfig.robinhoodTestnet
  );
  await checkChain("arbitrum-sepolia", process.env.RPC_ARBITRUM_SEPOLIA, lzConfig.arbitrumSepolia);
  await checkChain("base-sepolia", process.env.RPC_BASE_SEPOLIA, lzConfig.baseSepolia);
}

main().catch(console.error);
