const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CredScoreSBT", function () {
  async function fixture() {
    const [owner, scorer, user] = await ethers.getSigners();
    const SBT = await ethers.getContractFactory("CredScoreSBT");
    const sbt = await SBT.deploy(owner.address);
    await sbt.grantRole(await sbt.SCORER_ROLE(), scorer.address);
    return { sbt, owner, scorer, user };
  }

  it("mints SBT with correct score", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 71, 68, 60, "ipfs://test");
    const profile = await sbt.getProfile(user.address);
    expect(profile.score).to.equal(650);
    expect(profile.exists).to.equal(true);
    expect(await sbt.ownerOf(1)).to.equal(user.address);
  });

  it("blocks SBT transfer", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 71, 68, 60, "ipfs://test");
    await expect(
      sbt.connect(user).transferFrom(user.address, scorer.address, 1)
    ).to.be.revertedWith("SBT: non-transferable");
  });

  it("records default and increments defaultCount", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 71, 68, 60, "ipfs://test");
    const agentRole = await sbt.AGENT_ROLE();
    await sbt.grantRole(agentRole, scorer.address);
    await sbt.connect(scorer).recordDefault(user.address);
    const profile = await sbt.getProfile(user.address);
    expect(profile.defaultCount).to.equal(1);
    expect(profile.loanStatus).to.equal(3);
  });

  it("rejects duplicate mint", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 71, 68, 60, "ipfs://test");
    await expect(
      sbt.connect(scorer).mintSBT(user.address, 700, 80, 70, 65, "ipfs://test2")
    ).to.be.revertedWith("SBT already exists");
  });
});
