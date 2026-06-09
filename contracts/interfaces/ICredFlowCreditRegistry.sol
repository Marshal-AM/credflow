// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice LayerZero-synced credit state read by spoke lending contracts.
interface ICredFlowCreditRegistry {
    function getScore(address wallet) external view returns (uint16);

    function isBlacklisted(address wallet) external view returns (bool);

    function isLoanActive(address wallet) external view returns (bool);
}
