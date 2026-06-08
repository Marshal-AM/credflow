const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockPriceOracle", function () {
  it("returns correct USD value with 6 decimals", async () => {
    const MockOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockOracle.deploy();
    const weth = "0x7943e237c7F95DA44E0301572D358911207852Fa";

    // $3000 per 1 WETH
    await oracle.setPrice(weth, 3000n * 10n ** 6n, 18);

    const oneEth = ethers.parseEther("1");
    const value = await oracle.getValueUSD(weth, oneEth);
    expect(value).to.equal(3000n * 10n ** 6n);

    const halfEth = ethers.parseEther("0.5");
    const halfValue = await oracle.getValueUSD(weth, halfEth);
    expect(halfValue).to.equal(1500n * 10n ** 6n);
  });
});
