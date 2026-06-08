const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  USDG,
  WETH,
  ERC20_ABI,
  WETH_ABI,
  credFlowFundedFixture,
  transferUSDGTo,
  wrapEth,
} = require("./helpers");

describe("CredFlowLP", function () {
  it("tracks utilization on borrow and repayment", async function () {
    this.timeout(120000);
    const { pool, lending, sbt, agent, borrower } = await loadFixture(credFlowFundedFixture);

    const depositAmt = ethers.parseUnits("10", 6);
    await transferUSDGTo(borrower.address, depositAmt);

    const usdg = new ethers.Contract(USDG, ERC20_ABI, borrower);
    await usdg.connect(borrower).approve(await pool.getAddress(), depositAmt);
    await pool.connect(borrower).deposit(depositAmt);
    expect(await pool.utilizationRate()).to.equal(0);

    await sbt.connect(agent).mintSBT(borrower.address, 624, 68, 60, "ipfs://test");

    const collateral = ethers.parseEther("0.03");
    await wrapEth(borrower, collateral);
    const weth = new ethers.Contract(WETH, WETH_ABI, borrower);
    await weth.approve(await lending.getAddress(), collateral);

    const borrowAmount = ethers.parseUnits("20", 6);
    await lending.connect(borrower).requestLoan(borrowAmount, WETH, collateral, 30);

    expect(await pool.totalBorrowed()).to.equal(borrowAmount);
    expect(await pool.utilizationRate()).to.be.gt(0);
  });

  it("rejects recordBorrow from non-lending caller", async function () {
    const { pool, owner } = await loadFixture(credFlowFundedFixture);
    await expect(pool.connect(owner).recordBorrow(100)).to.be.revertedWith(
      "Not lending contract"
    );
  });
});
