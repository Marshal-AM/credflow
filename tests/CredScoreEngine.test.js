const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CredScoreEngine", function () {
  async function fixture() {
    const [admin, scorer, user] = await ethers.getSigners();
    const SBT = await ethers.getContractFactory("CredScoreSBT");
    const sbt = await SBT.deploy(admin.address);
    const Engine = await ethers.getContractFactory("CredScoreEngine");
    const engine = await Engine.deploy(await sbt.getAddress(), admin.address);

    const SCORER_ROLE = await sbt.SCORER_ROLE();
    await sbt.grantRole(SCORER_ROLE, await engine.getAddress());
    await engine.grantRole(await engine.SCORER_ROLE(), scorer.address);

    return { sbt, engine, admin, scorer, user };
  }

  it("computeCredScore matches formula with no balance boost", async function () {
    const { engine } = await loadFixture(fixture);
    // 1% default prob, $50 balance → factor 10000
    const score = await engine.computeCredScore(100, 5000);
    // 300 + (1 - 0.01) * 550 = 844.5 → 844
    expect(score).to.equal(844);
  });

  it("applies balance capacity tiers", async function () {
    const { engine } = await loadFixture(fixture);
    expect(await engine.balanceCapacityFactorBps(5000)).to.equal(10000);
    expect(await engine.balanceCapacityFactorBps(10000)).to.equal(9800);
    expect(await engine.balanceCapacityFactorBps(150000)).to.equal(9600);
    expect(await engine.balanceCapacityFactorBps(600000)).to.equal(9200);
  });

  it("higher balance increases score vs low balance", async function () {
    const { engine } = await loadFixture(fixture);
    const low = await engine.computeCredScore(500, 5000);
    const high = await engine.computeCredScore(500, 600000);
    expect(high).to.be.gt(low);
  });

  it("mintScore mints SBT with on-chain computed score", async function () {
    const { sbt, engine, scorer, user } = await loadFixture(fixture);
    const proofHash = ethers.id("reclaim-proof-test");

    await expect(
      engine.connect(scorer).mintScore(
        user.address,
        200,
        200000,
        proofHash,
        70,
        65,
        "ipfs://shap",
        false
      )
    ).to.emit(engine, "ScoreComputed");

    const profile = await sbt.getProfile(user.address);
    expect(profile.exists).to.equal(true);
    expect(profile.score).to.be.gte(300);
    expect(profile.score).to.be.lte(850);
    expect(await sbt.ownerOf(1)).to.equal(user.address);
  });

  it("mintScore updates existing profile when rescore=true", async function () {
    const { sbt, engine, scorer, user } = await loadFixture(fixture);
    const proofHash = ethers.id("reclaim-proof");

    await engine.connect(scorer).mintScore(
      user.address,
      300,
      10000,
      proofHash,
      60,
      55,
      "ipfs://a",
      false
    );
    const before = await sbt.getProfile(user.address);

    await engine.connect(scorer).mintScore(
      user.address,
      100,
      500000,
      proofHash,
      80,
      75,
      "ipfs://b",
      true
    );
    const after = await sbt.getProfile(user.address);
    expect(after.score).to.be.gt(before.score);
    expect(after.borrowSubScore).to.equal(80);
  });

  it("rejects duplicate mint without rescore", async function () {
    const { engine, scorer, user } = await loadFixture(fixture);
    const proofHash = ethers.id("p");
    await engine.connect(scorer).mintScore(user.address, 100, 0, proofHash, 50, 50, "ipfs://x", false);
    await expect(
      engine.connect(scorer).mintScore(user.address, 100, 0, proofHash, 50, 50, "ipfs://y", false)
    ).to.be.revertedWith("SBT already exists");
  });
});
