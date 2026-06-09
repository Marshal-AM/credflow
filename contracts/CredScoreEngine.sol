// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CredScoreSBT.sol";

/// @title CredScoreEngine — on-chain CredScore formula + Reclaim balance capacity factor
contract CredScoreEngine is AccessControl {
    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");

    CredScoreSBT public immutable sbtContract;

    event ScoreComputed(
        address indexed wallet,
        uint16 defaultProbBps,
        uint32 balanceUsdCents,
        uint16 credScore,
        bytes32 reclaimProofHash
    );

    constructor(address sbt, address admin) {
        require(sbt != address(0), "Invalid SBT");
        sbtContract = CredScoreSBT(sbt);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice USD capacity tiers — higher balance reduces default probability (max ~8%)
    function balanceCapacityFactorBps(uint32 balanceUsdCents) public pure returns (uint256) {
        uint256 usdWhole = balanceUsdCents / 100;
        if (usdWhole >= 5000) return 9200;
        if (usdWhole >= 1000) return 9600;
        if (usdWhole >= 100) return 9800;
        return 10000;
    }

    /// @dev cred_score = clamp(300 + (1 - adjusted_default_prob) * 550, 300, 850)
    function computeCredScore(uint16 defaultProbBps, uint32 balanceUsdCents) public pure returns (uint16) {
        uint256 factor = balanceCapacityFactorBps(balanceUsdCents);
        uint256 adjustedProbBps = (uint256(defaultProbBps) * factor) / 10000;
        if (adjustedProbBps > 10000) adjustedProbBps = 10000;
        uint256 score = 300 + ((10000 - adjustedProbBps) * 550) / 10000;
        if (score < 300) return 300;
        if (score > 850) return 850;
        return uint16(score);
    }

    /// @notice Compute final score on-chain and mint or update SBT
    function mintScore(
        address wallet,
        uint16 defaultProbBps,
        uint32 balanceUsdCents,
        bytes32 reclaimProofHash,
        uint16 borrowSub,
        uint16 walletSub,
        string calldata shapCID,
        bool rescore
    ) external onlyRole(SCORER_ROLE) returns (uint16 credScore) {
        credScore = computeCredScore(defaultProbBps, balanceUsdCents);
        require(credScore >= 300 && credScore <= 850, "Invalid score range");

        if (!rescore) {
            require(!sbtContract.hasProfile(wallet), "SBT already exists");
            sbtContract.mintSBT(wallet, credScore, borrowSub, walletSub, shapCID);
        } else {
            require(sbtContract.hasProfile(wallet), "No SBT found");
            sbtContract.updateScore(wallet, credScore, borrowSub, walletSub, shapCID);
        }

        if (reclaimProofHash != bytes32(0)) {
            sbtContract.addAttestation(wallet, reclaimProofHash);
        }

        emit ScoreComputed(wallet, defaultProbBps, balanceUsdCents, credScore, reclaimProofHash);
    }
}
