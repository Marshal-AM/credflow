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
    await sbt.connect(scorer).mintSBT(user.address, 650, 68, 60, "ipfs://test");
    const profile = await sbt.getProfile(user.address);
    expect(profile.score).to.equal(650);
    expect(profile.exists).to.equal(true);
    expect(await sbt.ownerOf(1)).to.equal(user.address);
  });

  it("blocks SBT transfer", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 68, 60, "ipfs://test");
    await expect(
      sbt.connect(user).transferFrom(user.address, scorer.address, 1)
    ).to.be.revertedWith("SBT: non-transferable");
  });

  it("records default and increments defaultCount", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 68, 60, "ipfs://test");
    const agentRole = await sbt.AGENT_ROLE();
    await sbt.grantRole(agentRole, scorer.address);
    await sbt.connect(scorer).recordDefault(user.address);
    const profile = await sbt.getProfile(user.address);
    expect(profile.defaultCount).to.equal(1);
    expect(profile.loanStatus).to.equal(3);
  });

  it("rejects duplicate mint", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    await sbt.connect(scorer).mintSBT(user.address, 650, 68, 60, "ipfs://test");
    await expect(
      sbt.connect(scorer).mintSBT(user.address, 700, 70, 65, "ipfs://test2")
    ).to.be.revertedWith("SBT already exists");
  });

  it("blacklists linked wallets via AGENT_ROLE", async function () {
    const { sbt, owner, user } = await loadFixture(fixture);
    const linked = ethers.Wallet.createRandom().address;
    const agentRole = await sbt.AGENT_ROLE();
    await sbt.grantRole(agentRole, owner.address);

    await expect(
      sbt.connect(owner).blacklistLinkedWallets([linked], user.address)
    )
      .to.emit(sbt, "WalletBlacklisted")
      .withArgs(linked, user.address);

    expect(await sbt.isBlacklisted(linked)).to.equal(true);
    expect(await sbt.blacklistedVia(linked)).to.equal(user.address);
  });

  it("rejects blacklistLinkedWallets without AGENT_ROLE", async function () {
    const { sbt, scorer, user } = await loadFixture(fixture);
    const linked = ethers.Wallet.createRandom().address;
    await expect(
      sbt.connect(scorer).blacklistLinkedWallets([linked], user.address)
    ).to.be.reverted;
  });

  it("removeFromBlacklist clears blacklist state", async function () {
    const { sbt, owner, user } = await loadFixture(fixture);
    const linked = ethers.Wallet.createRandom().address;
    const agentRole = await sbt.AGENT_ROLE();
    await sbt.grantRole(agentRole, owner.address);

    await sbt.connect(owner).blacklistLinkedWallets([linked], user.address);
    expect(await sbt.isBlacklisted(linked)).to.equal(true);

    await expect(sbt.connect(owner).removeFromBlacklist(linked))
      .to.emit(sbt, "WalletUnblacklisted")
      .withArgs(linked);

    expect(await sbt.isBlacklisted(linked)).to.equal(false);
    expect(await sbt.blacklistedVia(linked)).to.equal(ethers.ZeroAddress);
  });

  it("whitelistWallet clears blacklist and defaultCount", async function () {
    const { sbt, owner, scorer, user } = await loadFixture(fixture);
    const linked = ethers.Wallet.createRandom().address;
    const agentRole = await sbt.AGENT_ROLE();
    await sbt.grantRole(agentRole, owner.address);

    await sbt.connect(scorer).mintSBT(user.address, 650, 68, 60, "ipfs://test");
    await sbt.connect(owner).recordDefault(user.address);
    await sbt.connect(owner).blacklistLinkedWallets([linked], user.address);

    let profile = await sbt.getProfile(user.address);
    expect(profile.defaultCount).to.equal(1);
    expect(await sbt.isBlacklisted(linked)).to.equal(true);

    await expect(sbt.connect(owner).whitelistWallet(user.address))
      .to.emit(sbt, "WalletWhitelisted")
      .withArgs(user.address);

    profile = await sbt.getProfile(user.address);
    expect(profile.defaultCount).to.equal(0);
    expect(await sbt.isBlacklisted(user.address)).to.equal(false);

    await expect(sbt.connect(owner).removeFromBlacklist(linked))
      .to.emit(sbt, "WalletUnblacklisted")
      .withArgs(linked);
    expect(await sbt.isBlacklisted(linked)).to.equal(false);
  });
});
