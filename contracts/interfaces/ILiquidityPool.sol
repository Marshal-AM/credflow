// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILiquidityPool {
    function recordBorrow(uint256 amount) external;
    function recordRepayment(uint256 amount) external;
}
