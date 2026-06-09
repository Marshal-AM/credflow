const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const wallet = process.argv[2] || process.env.AGENT_WALLET_ADDRESS;
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "addresses.json"), "utf8")
  );
  const sbt = await ethers.getContractAt("CredScoreSBT", addresses.sbt);
  const lending = await ethers.getContractAt("CredFlowLending", addresses.lending);

  console.log("wallet:", wallet);
  console.log("hasProfile:", await sbt.hasProfile(wallet));
  if (await sbt.hasProfile(wallet)) {
    const p = await sbt.getProfile(wallet);
    console.log("score:", p.score, "loanActive:", p.loanActive);
  }
  console.log("activeLoanId:", (await lending.activeLoanId(wallet)).toString());
  console.log("loanCounter:", (await lending.loanCounter()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
