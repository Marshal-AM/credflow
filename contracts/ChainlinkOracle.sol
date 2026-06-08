// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ILTVOracle.sol";

/// @title ChainlinkOracle — USD valuation for collateral tokens via Chainlink feeds
contract ChainlinkOracle is ILTVOracle, Ownable {
    mapping(address => address) public priceFeeds;
    mapping(address => uint8) public tokenDecimals;

    event PriceFeedSet(address indexed token, address indexed feed, uint8 tokenDecimals_);

    constructor(address admin) {
        _transferOwnership(admin);
    }

    function setPriceFeed(address token, address feed, uint8 decimals_) external onlyOwner {
        require(token != address(0) && feed != address(0), "Invalid address");
        priceFeeds[token] = feed;
        tokenDecimals[token] = decimals_;
        emit PriceFeedSet(token, feed, decimals_);
    }

    /// @notice Returns USD value with 6 decimals (USDG-compatible)
    function getValueUSD(address token, uint256 amount) external view override returns (uint256) {
        address feed = priceFeeds[token];
        require(feed != address(0), "No price feed");

        uint8 decimals = tokenDecimals[token];
        require(decimals > 0, "Token decimals unset");

        (, int256 price,,,) = AggregatorV3Interface(feed).latestRoundData();
        require(price > 0, "Invalid price");

        uint8 feedDecimals = AggregatorV3Interface(feed).decimals();
        // valueUSD_6dec = amount * price * 10^6 / (10^tokenDecimals * 10^feedDecimals)
        return (amount * uint256(price) * 1e6) / (10 ** decimals) / (10 ** feedDecimals);
    }
}
