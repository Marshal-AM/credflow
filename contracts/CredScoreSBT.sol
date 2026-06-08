// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

contract CredScoreSBT is ERC721, AccessControl, Pausable, UUPSUpgradeable {
    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    struct CreditProfile {
        uint16 score;
        uint16 borrowSubScore;
        uint16 walletSubScore;
        uint8 loanStatus;
        uint8 totalLoans;
        uint8 defaultCount;
        uint32 lastUpdated;
        bool exists;
        bool loanActive;
        string shapeExplanationCID;
    }

    mapping(address => CreditProfile) public profiles;
    mapping(address => bytes32[]) public attestations;

    uint256 private _tokenIdCounter;

    event SBTMinted(address indexed wallet, uint16 initialScore);
    event ScoreUpdated(address indexed wallet, uint16 oldScore, uint16 newScore);
    event LoanStatusUpdated(address indexed wallet, uint8 status);
    event DefaultRecorded(address indexed wallet, uint32 timestamp);
    event AttestationAdded(address indexed wallet, bytes32 proofHash);

    constructor(address admin) ERC721("CredScore SBT", "CSSBT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mintSBT(
        address wallet,
        uint16 score,
        uint16 borrowSub,
        uint16 walletSub,
        string calldata shapCID
    ) external onlyRole(SCORER_ROLE) whenNotPaused {
        require(!profiles[wallet].exists, "SBT already exists");
        require(score >= 300 && score <= 850, "Invalid score range");

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;
        _safeMint(wallet, tokenId);

        profiles[wallet] = CreditProfile({
            score: score,
            borrowSubScore: borrowSub,
            walletSubScore: walletSub,
            loanStatus: 0,
            totalLoans: 0,
            defaultCount: 0,
            lastUpdated: uint32(block.timestamp),
            exists: true,
            loanActive: false,
            shapeExplanationCID: shapCID
        });

        emit SBTMinted(wallet, score);
    }

    function updateScore(
        address wallet,
        uint16 newScore,
        uint16 borrowSub,
        uint16 walletSub,
        string calldata shapCID
    ) external onlyRole(SCORER_ROLE) {
        require(profiles[wallet].exists, "No SBT found");
        uint16 old = profiles[wallet].score;
        profiles[wallet].score = newScore;
        profiles[wallet].borrowSubScore = borrowSub;
        profiles[wallet].walletSubScore = walletSub;
        profiles[wallet].lastUpdated = uint32(block.timestamp);
        profiles[wallet].shapeExplanationCID = shapCID;
        emit ScoreUpdated(wallet, old, newScore);
    }

    function setLoanActive(address wallet) external onlyRole(AGENT_ROLE) {
        profiles[wallet].loanActive = true;
        profiles[wallet].loanStatus = 1;
        profiles[wallet].totalLoans++;
        emit LoanStatusUpdated(wallet, 1);
    }

    function setLoanRepaid(address wallet) external onlyRole(AGENT_ROLE) {
        profiles[wallet].loanActive = false;
        profiles[wallet].loanStatus = 2;
        emit LoanStatusUpdated(wallet, 2);
    }

    function recordDefault(address wallet) external onlyRole(AGENT_ROLE) {
        profiles[wallet].loanActive = false;
        profiles[wallet].loanStatus = 3;
        profiles[wallet].defaultCount++;
        emit DefaultRecorded(wallet, uint32(block.timestamp));
    }

    function addAttestation(address wallet, bytes32 proofHash) external onlyRole(SCORER_ROLE) {
        attestations[wallet].push(proofHash);
        emit AttestationAdded(wallet, proofHash);
    }

    function getProfile(address wallet) external view returns (CreditProfile memory) {
        return profiles[wallet];
    }

    function hasProfile(address wallet) external view returns (bool) {
        return profiles[wallet].exists;
    }

    function _beforeTokenTransfer(address from, address, uint256, uint256) internal pure override {
        require(from == address(0), "SBT: non-transferable");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
