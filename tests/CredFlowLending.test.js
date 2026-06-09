const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  USDG,
  WETH,
  ERC20_ABI,
  WETH_ABI,
  credFlowFundedFixture,
  wrapEth,
} = require("./helpers");

// Scaled for ~50 USDG on deployer wallet: fund 40, borrow 40 @ 60% LTV with 0.03 WETH
const BORROW_AMOUNT = ethers.parseUnits("40", 6);
const COLLATERAL = ethers.parseEther("0.03");

describe("CredFlowLending", function () {
  async function setupBorrower(f, score = 624) {
    await f.sbt.connect(f.agent).mintSBT(f.borrower.address, score, 68, 60, "ipfs://maya");
    await wrapEth(f.borrower, COLLATERAL);
    const weth = new ethers.Contract(WETH, WETH_ABI, f.borrower);
    await weth.approve(await f.lending.getAddress(), COLLATERAL);
  }

  it("score 624 allows borrow at 60% LTV (Maya scenario, scaled)", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    await setupBorrower(f);

    await expect(
      f.lending.connect(f.borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30)
    ).to.emit(f.lending, "LoanCreated");

    const usdg = new ethers.Contract(USDG, ERC20_ABI, f.borrower);
    expect(await usdg.balanceOf(f.borrower.address)).to.equal(BORROW_AMOUNT);
  });

  it("rejects borrow when LTV exceeded", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    await f.sbt.connect(f.agent).mintSBT(f.borrower.address, 624, 68, 60, "ipfs://maya");
    const smallCollateral = ethers.parseEther("0.02");
    await wrapEth(f.borrower, smallCollateral);
    const weth = new ethers.Contract(WETH, WETH_ABI, f.borrower);
    await weth.approve(await f.lending.getAddress(), smallCollateral);

    await expect(
      f.lending
        .connect(f.borrower)
        .requestLoan(ethers.parseUnits("38", 6), WETH, smallCollateral, 30)
    ).to.be.revertedWith("Exceeds max LTV");
  });

  it("rejects borrow without SBT profile", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    await wrapEth(f.borrower, COLLATERAL);
    const weth = new ethers.Contract(WETH, WETH_ABI, f.borrower);
    await weth.approve(await f.lending.getAddress(), COLLATERAL);

    await expect(
      f.lending.connect(f.borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30)
    ).to.be.revertedWith("No credit profile");
  });

  it("repayLoan returns collateral", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    await setupBorrower(f);
    await f.lending.connect(f.borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30);

    const usdg = new ethers.Contract(USDG, ERC20_ABI, f.borrower);
    await usdg.connect(f.borrower).approve(await f.lending.getAddress(), BORROW_AMOUNT * 2n);

    await expect(f.lending.connect(f.borrower).repayLoan(1)).to.emit(f.lending, "LoanRepaid");

    const weth = new ethers.Contract(WETH, WETH_ABI, f.borrower);
    expect(await weth.balanceOf(f.borrower.address)).to.equal(COLLATERAL);
  });

  it("getLTVForScore returns correct tiers", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    expect(await f.lending.getLTVForScore(624)).to.equal(6000);
    expect(await f.lending.getLTVForScore(680)).to.equal(6500);
    expect(await f.lending.getLTVForScore(400)).to.equal(0);
  });

  it("getRateForScore returns tiered rates", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    expect(await f.lending.getRateForScore(624)).to.equal(900);
    expect(await f.lending.getRateForScore(750)).to.equal(600);
  });

  it("liquidate requires AGENT_ROLE and high LTV", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    await setupBorrower(f);
    await f.lending.connect(f.borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30);

    await expect(f.lending.connect(f.borrower).liquidate(1)).to.be.reverted;

    await f.oracle.setPrice(WETH, 2000n * 10n ** 6n, 18);
    await expect(f.lending.connect(f.owner).liquidate(1)).to.be.revertedWith("Not liquidatable");

    await f.oracle.setPrice(WETH, 100n * 10n ** 6n, 18);
    expect(await f.lending.getCurrentLTV(1)).to.be.gte(await f.lending.liquidationThreshold());

    await expect(f.lending.connect(f.agent).liquidate(1)).to.emit(f.lending, "LoanLiquidated");
  });

  it("rejects borrow when wallet is blacklisted", async function () {
    const f = await loadFixture(credFlowFundedFixture);
    await setupBorrower(f);

    const defaulter = f.owner.address;
    await f.sbt.connect(f.agent).blacklistLinkedWallets([f.borrower.address], defaulter);
    expect(await f.sbt.isBlacklisted(f.borrower.address)).to.equal(true);

    await expect(
      f.lending.connect(f.borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30)
    ).to.be.revertedWith("Wallet blacklisted");
  });
});
