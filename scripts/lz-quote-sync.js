const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { buildLzOptions } = require("../layerzero/buildLzOptions");

const MSG_SCORE_UPDATE = 1;

async function main() {
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
  );
  const hubOApp = process.env.HUB_OAPP_ADDRESS || addresses.oapp;
  const wallet = process.argv[2] || process.env.AGENT_WALLET_ADDRESS;
  const score = Number(process.argv[3] || "842");

  const eids = [
    Number(process.env.LZ_EID_ARBITRUM || "40231"),
    Number(process.env.LZ_EID_BASE || "40245"),
  ];

  const oapp = await ethers.getContractAt("CredFlowOApp", hubOApp);
  const endpointAddr = addresses.layerzero.endpointV2;
  const endpoint = await ethers.getContractAt(
    [
      "function quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) params, address sender) view returns ((uint256 nativeFee, uint256 lzTokenFee))",
    ],
    endpointAddr
  );

  const options = "0x" + buildLzOptions(200000);
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "uint16"],
    [MSG_SCORE_UPDATE, wallet, score]
  );

  let totalNative = 0n;
  for (const eid of eids) {
    const peer = await oapp.peers(eid);
    const fee = await endpoint.quote(
      {
        dstEid: eid,
        receiver: peer,
        message: payload,
        options,
        payInLzToken: false,
      },
      hubOApp
    );
    console.log(`eid ${eid} nativeFee:`, fee.nativeFee.toString());
    totalNative += fee.nativeFee;
  }

  console.log("totalNativeFee:", totalNative.toString());
  console.log("totalNative ETH:", ethers.formatEther(totalNative));

  const fn = oapp.getFunction("broadcastScore");
  const tx = await fn.send(eids, wallet, score, options, { value: totalNative });
  const receipt = await tx.wait();
  console.log("broadcastScore tx:", receipt.hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
