const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

const { buildLzOptions } = require("../layerzero/buildLzOptions");

async function main() {
  const wallet = process.env.BROADCAST_WALLET || process.env.AGENT_WALLET_ADDRESS;
  const hubOApp = process.env.HUB_OAPP_ADDRESS;
  const msgType = (process.env.LZ_BROADCAST_TYPE || "loanActive").toLowerCase();

  if (!wallet || !hubOApp) {
    throw new Error("Set AGENT_WALLET_ADDRESS and HUB_OAPP_ADDRESS");
  }

  const eids = [];
  if (process.env.ARBITRUM_OAPP_ADDRESS) {
    eids.push(Number(process.env.LZ_EID_ARBITRUM || "40231"));
  }
  if (process.env.BASE_OAPP_ADDRESS) {
    eids.push(Number(process.env.LZ_EID_BASE || "40245"));
  }
  if (eids.length === 0) throw new Error("No spoke OApps configured in .env");

  const perDest = BigInt(process.env.LZ_NATIVE_FEE_PER_DST || "700000000000000");
  const options = "0x" + buildLzOptions(200000);

  const oapp = await ethers.getContractAt("CredFlowOApp", hubOApp);
  let lastTx;

  for (const eid of eids) {
    let tx;
    if (msgType === "repaid") {
      tx = await oapp.broadcastRepaid([eid], wallet, options, { value: perDest });
    } else {
      tx = await oapp.broadcastLoanActive([eid], wallet, options, { value: perDest });
    }
    console.log(`broadcast ${msgType} eid=${eid} tx=${tx.hash}`);
    const receipt = await tx.wait();
    console.log("  confirmed block", receipt.blockNumber);
    lastTx = tx.hash;
  }

  console.log("Done. Last tx:", lastTx);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
