// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OApp, Origin, MessagingFee} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CredScoreSBT.sol";
import "./interfaces/ICredFlowCreditRegistry.sol";

contract CredFlowOApp is OApp, AccessControl, ICredFlowCreditRegistry {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    CredScoreSBT public sbtContract;

    uint8 constant MSG_SCORE_UPDATE = 1;
    uint8 constant MSG_LOAN_ACTIVE = 2;
    uint8 constant MSG_DEFAULT = 3;
    uint8 constant MSG_REPAID = 4;
    uint8 constant MSG_WHITELIST = 5;

    mapping(address => uint16) public spokeScores;
    mapping(address => bool) public defaultBlacklist;
    mapping(address => bool) public loanActiveMirror;

    event ScoreReceived(address indexed wallet, uint16 score, uint32 srcChain);
    event DefaultReceived(address indexed wallet, uint32 srcChain);
    event LoanActiveReceived(address indexed wallet, uint32 srcChain);
    event LoanRepaidReceived(address indexed wallet, uint32 srcChain);
    event WhitelistReceived(address indexed wallet, uint16 score, uint32 srcChain);
    event WhitelistAppliedLocal(address indexed wallet, uint16 score);

    constructor(address _endpoint, address _sbt, address admin) OApp(_endpoint, admin) {
        sbtContract = CredScoreSBT(_sbt);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function broadcastScore(
        uint32[] calldata dstChainIds,
        address wallet,
        uint16 score,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_SCORE_UPDATE, wallet, score);
        for (uint256 i = 0; i < dstChainIds.length; i++) {
            _lzSend(
                dstChainIds[i],
                payload,
                options,
                MessagingFee(msg.value / dstChainIds.length, 0),
                payable(msg.sender)
            );
        }
    }

    function broadcastLoanActive(
        uint32[] calldata dstChainIds,
        address wallet,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_LOAN_ACTIVE, wallet, uint16(0));
        for (uint256 i = 0; i < dstChainIds.length; i++) {
            _lzSend(
                dstChainIds[i],
                payload,
                options,
                MessagingFee(msg.value / dstChainIds.length, 0),
                payable(msg.sender)
            );
        }
    }

    function broadcastRepaid(
        uint32[] calldata dstChainIds,
        address wallet,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_REPAID, wallet, uint16(0));
        for (uint256 i = 0; i < dstChainIds.length; i++) {
            _lzSend(
                dstChainIds[i],
                payload,
                options,
                MessagingFee(msg.value / dstChainIds.length, 0),
                payable(msg.sender)
            );
        }
    }

    function broadcastDefault(
        uint32[] calldata dstChainIds,
        address wallet,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_DEFAULT, wallet, uint16(310));
        for (uint256 i = 0; i < dstChainIds.length; i++) {
            _lzSend(
                dstChainIds[i],
                payload,
                options,
                MessagingFee(msg.value / dstChainIds.length, 0),
                payable(msg.sender)
            );
        }
    }

    function broadcastWhitelist(
        uint32[] calldata dstChainIds,
        address wallet,
        uint16 score,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_WHITELIST, wallet, score);
        for (uint256 i = 0; i < dstChainIds.length; i++) {
            _lzSend(
                dstChainIds[i],
                payload,
                options,
                MessagingFee(msg.value / dstChainIds.length, 0),
                payable(msg.sender)
            );
        }
    }

    /// @dev Direct spoke reset when LZ delivery is slow (test recovery / agent fallback).
    function clearDefaultBlacklist(address wallet, uint16 score) external onlyRole(AGENT_ROLE) {
        defaultBlacklist[wallet] = false;
        if (score > 0) {
            spokeScores[wallet] = score;
        }
        emit WhitelistAppliedLocal(wallet, score);
    }

    /// @dev On spoke chains sbtContract is address(0) — we only mirror scores locally,
    ///      never call the SBT contract on spokes.
    function _lzReceive(
        Origin calldata origin,
        bytes32,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        (uint8 msgType, address wallet, uint16 data) = abi.decode(message, (uint8, address, uint16));

        if (msgType == MSG_SCORE_UPDATE) {
            spokeScores[wallet] = data;
            emit ScoreReceived(wallet, data, origin.srcEid);
        } else if (msgType == MSG_LOAN_ACTIVE) {
            loanActiveMirror[wallet] = true;
            emit LoanActiveReceived(wallet, origin.srcEid);
        } else if (msgType == MSG_DEFAULT) {
            defaultBlacklist[wallet] = true;
            spokeScores[wallet] = 310;
            loanActiveMirror[wallet] = false;
            emit DefaultReceived(wallet, origin.srcEid);
        } else if (msgType == MSG_REPAID) {
            loanActiveMirror[wallet] = false;
            emit LoanRepaidReceived(wallet, origin.srcEid);
        } else if (msgType == MSG_WHITELIST) {
            defaultBlacklist[wallet] = false;
            if (data > 0) {
                spokeScores[wallet] = data;
            }
            emit WhitelistReceived(wallet, data, origin.srcEid);
        }
    }

    function getScore(address wallet) external view returns (uint16) {
        return spokeScores[wallet];
    }

    function isBlacklisted(address wallet) external view returns (bool) {
        return defaultBlacklist[wallet];
    }

    function isLoanActive(address wallet) external view returns (bool) {
        return loanActiveMirror[wallet];
    }
}
