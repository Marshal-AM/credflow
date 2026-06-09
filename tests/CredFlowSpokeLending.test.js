const { expect } = require("chai");
const { ethers } = require("hardhat");
const { WETH_ABI, wrapEth } = require("./helpers");

const BORROW_AMOUNT = ethers.parseUnits("5", 6);
const COLLATERAL = ethers.parseEther("0.01");
const SCORE = 624;

describe("CredFlowSpokeLending", function () {
  async function deploySpokeFixture() {
    const [owner, borrower] = await ethers.getSigners();

    const MockRegistry = await ethers.getContractFactory("MockCreditRegistry");
    const registry = await MockRegistry.deploy();
    await registry.waitForDeployment();

    const MockOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockOracle.deploy();
    await oracle.waitForDeployment();

    const WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";
    await oracle.setPrice(WETH, 3000n * 10n ** 6n, 18);

    const MockToken = await ethers.getContractFactory("MockERC20");
    const usdc = await MockToken.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const Pool = await ethers.getContractFactory("CredFlowLP");
    const pool = await Pool.deploy(await usdc.getAddress());
    await pool.waitForDeployment();

    const Lending = await ethers.getContractFactory("CredFlowSpokeLending");
    const lending = await Lending.deploy(
      await registry.getAddress(),
      await oracle.getAddress(),
      await usdc.getAddress(),
      owner.address
    );
    await lending.waitForDeployment();

    await pool.setLendingContract(await lending.getAddress());
    await lending.setLiquidityPool(await pool.getAddress());

    await usdc.mint(await lending.getAddress(), ethers.parseUnits("100", 6));
    await usdc.mint(borrower.address, ethers.parseUnits("100", 6));

    return { owner, borrower, registry, oracle, usdc, lending, WETH };
  }

  it("rejects borrow without LZ score", async function () {
    const { borrower, registry, lending, WETH } = await deploySpokeFixture();
    // score intentionally unset — must prove LZ sync required
    await registry.setScore(borrower.address, 0);
    await expect(
      lending.connect(borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30)
    ).to.be.revertedWith("No LZ credit score");
  });

  it("borrows using mirrored score and LTV tiers", async function () {
    const { borrower, registry, lending, usdc, WETH } = await deploySpokeFixture();
    await registry.setScore(borrower.address, SCORE);

    const weth = new ethers.Contract(WETH, WETH_ABI, borrower);
    await wrapEth(borrower, COLLATERAL);
    await weth.approve(await lending.getAddress(), COLLATERAL);

    const before = await usdc.balanceOf(borrower.address);
    await lending.connect(borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30);
    const after = await usdc.balanceOf(borrower.address);
    expect(after - before).to.equal(BORROW_AMOUNT);
  });

  it("blocks borrow when cross-chain loan active", async function () {
    const { borrower, registry, lending, WETH } = await deploySpokeFixture();
    await registry.setScore(borrower.address, SCORE);
    await registry.setLoanActive(borrower.address, true);

    const weth = new ethers.Contract(WETH, WETH_ABI, borrower);
    await wrapEth(borrower, COLLATERAL);
    await weth.approve(await lending.getAddress(), COLLATERAL);

    await expect(
      lending.connect(borrower).requestLoan(BORROW_AMOUNT, WETH, COLLATERAL, 30)
    ).to.be.revertedWith("Cross-chain loan active");
  });
});
