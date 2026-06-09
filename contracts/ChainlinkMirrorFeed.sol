// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ChainlinkMirrorFeed — on-chain mirror of a mainnet Chainlink ETH/USD feed.
/// @dev Price is pushed from scripts/chainlink.js (reads mainnet RPC). Used on spoke testnets
///      where mainnet feed contracts are not deployed. NOT a fixed-price mock.
contract ChainlinkMirrorFeed is AggregatorV3Interface, Ownable {
    uint8 private constant DECIMALS = 8;
    int256 public price;
    uint80 public roundId = 1;
    address public immutable mainnetFeed;
    string public mainnetNetwork;

    event PriceSynced(int256 newPrice, uint80 roundId, address indexed mainnetFeed);

    constructor(int256 initialPrice, address mainnetFeed_, string memory mainnetNetwork_, address admin) {
        require(initialPrice > 0, "Invalid price");
        require(mainnetFeed_ != address(0), "Invalid mainnet feed");
        price = initialPrice;
        mainnetFeed = mainnetFeed_;
        mainnetNetwork = mainnetNetwork_;
        _transferOwnership(admin);
    }

    /// @notice Update from off-chain mainnet Chainlink read (scripts/sync-spoke-oracle.js).
    function syncPrice(int256 newPrice) external onlyOwner {
        require(newPrice > 0, "Invalid price");
        price = newPrice;
        roundId++;
        emit PriceSynced(newPrice, roundId, mainnetFeed);
    }

    function decimals() external pure override returns (uint8) {
        return DECIMALS;
    }

    function description() external view override returns (string memory) {
        return string(abi.encodePacked("ETH / USD (mirror of ", mainnetNetwork, ")"));
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        require(_roundId == roundId, "Unknown round");
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }
}
