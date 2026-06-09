// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICredFlowCreditRegistry.sol";

/// @dev Test helper — not deployed to production spokes.
contract MockCreditRegistry is ICredFlowCreditRegistry {
    mapping(address => uint16) private _scores;
    mapping(address => bool) private _blacklisted;
    mapping(address => bool) private _loanActive;

    function setScore(address wallet, uint16 score) external {
        _scores[wallet] = score;
    }

    function setBlacklisted(address wallet, bool value) external {
        _blacklisted[wallet] = value;
    }

    function setLoanActive(address wallet, bool value) external {
        _loanActive[wallet] = value;
    }

    function getScore(address wallet) external view returns (uint16) {
        return _scores[wallet];
    }

    function isBlacklisted(address wallet) external view returns (bool) {
        return _blacklisted[wallet];
    }

    function isLoanActive(address wallet) external view returns (bool) {
        return _loanActive[wallet];
    }
}
