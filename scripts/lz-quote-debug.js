const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { buildLzOptions } = require("../layerzero/buildLzOptions");

async function main() {
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
  );
  const hubOApp = process.env.HUB_OAPP_ADDRESS || addresses.oapp;
  const wallet = process.env.AGENT_WALLET_ADDRESS;
  const score = 842;
  const eids = [40231, 40245];

  const oapp = await ethers.getContractAt("CredFlowOApp", hubOApp);
  const endpoint = await ethers.getContractAt(
    "ILayerZeroEndpointV2",
    addresses.layerzero.endpointV2
  );

  const options = "0x" + buildLzOptions(200000);
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "uint16"],
    [1, wallet, score]
  );

  let total = 0n;
  for (const eid of eids) {
    const peer = await oapp.peers(eid);
    console.log("eid", eid, "peer", peer);
    const params = {
      dstEid: eid,
      receiver: peer,
      message: payload,
      options,
      payInLzToken: false,
    };
    const fee = await endpoint.quote(params, hubOApp);
    console.log("  nativeFee", fee.nativeFee.toString());
    total += fee.nativeFee;
  }
  console.log("total", total.toString(), "ETH", ethers.formatEther(total));
}

main().catch(console.error);
