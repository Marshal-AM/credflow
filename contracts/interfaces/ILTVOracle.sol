// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILTVOracle {
    function getValueUSD(address token, uint256 amount) external view returns (uint256);
}
