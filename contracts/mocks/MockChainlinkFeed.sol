// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Testnet-only Chainlink-compatible feed when legacy AggregatorV3 feeds are unavailable.
/// Robinhood testnet uses Chainlink Data Streams; this mock wires WETH/USD into ChainlinkOracle.
contract MockChainlinkFeed is AggregatorV3Interface, Ownable {
    uint8 private constant DECIMALS = 8;
    int256 public price;
    uint80 public roundId = 1;

    constructor(int256 initialPrice, address admin) {
        require(initialPrice > 0, "Invalid price");
        price = initialPrice;
        _transferOwnership(admin);
    }

    function setPrice(int256 newPrice) external onlyOwner {
        require(newPrice > 0, "Invalid price");
        price = newPrice;
        roundId++;
    }

    function decimals() external pure override returns (uint8) {
        return DECIMALS;
    }

    function description() external pure override returns (string memory) {
        return "ETH / USD";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        require(_roundId == roundId, "Unknown round");
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }
}
