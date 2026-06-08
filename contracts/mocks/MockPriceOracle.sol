// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ILTVOracle.sol";

/// @dev Used only in isolated oracle unit tests — not deployed to testnet
contract MockPriceOracle is ILTVOracle {
    mapping(address => uint256) public prices;
    mapping(address => uint8) public tokenDecimals;

    function setPrice(address token, uint256 priceUSD, uint8 decimals_) external {
        prices[token] = priceUSD;
        tokenDecimals[token] = decimals_;
    }

    /// @notice priceUSD is 6-decimal USD per 1 whole token unit
    function getValueUSD(address token, uint256 amount) external view override returns (uint256) {
        uint256 priceUSD = prices[token];
        uint8 decimals = tokenDecimals[token];
        require(priceUSD > 0 && decimals > 0, "Price unset");
        return (amount * priceUSD) / (10 ** decimals);
    }
}
