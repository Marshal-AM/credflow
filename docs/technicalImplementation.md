CredFlow — Full Technical Implementation Document

Before You Start — Repository Structure
credflow/
├── contracts/          # Solidity smart contracts
├── agents/             # Python AI agents
├── ml/                 # ML model training and serving
├── indexer/            # Dune + Alchemy data pipeline
├── frontend/           # Next.js app
├── layerzero/          # Cross-chain messaging config
├── fhenix/             # FHE attestation module
├── scripts/            # Deployment and migration scripts
├── tests/              # Contract + agent tests
└── docs/               # ABIs, addresses, configs


PHASE 0 — Environment Setup
Everything else depends on this being correct. Do not skip steps.
Wallets and accounts to create:
Create a deployer wallet and fund it on Robinhood Chain testnet, Arbitrum Sepolia, and Base Sepolia. Store the private key in a .env file, never commit it. You need separate funded wallets for: contract deployment, agent operation, and testing.
Accounts to register:
Alchemy — create an app for Robinhood Chain, one for Arbitrum Sepolia, one for Base Sepolia. Save all three RPC URLs and Websocket URLs.
Dune Analytics — get API key, note your rate limits on the free tier.
GMX — no account needed, it's public on-chain data. But bookmark the GMX subgraph endpoint on Arbitrum.
Environment variables file:
DEPLOYER_PRIVATE_KEY=
AGENT_PRIVATE_KEY=

RPC_ROBINHOOD=
RPC_ARBITRUM_SEPOLIA=
RPC_BASE_SEPOLIA=

WS_ROBINHOOD=
WS_ARBITRUM_SEPOLIA=

ALCHEMY_API_KEY=
DUNE_API_KEY=

LAYERZERO_ENDPOINT_ROBINHOOD=
LAYERZERO_ENDPOINT_ARBITRUM=
LAYERZERO_ENDPOINT_BASE=

FHENIX_RPC=
FHENIX_API_KEY=

Install global dependencies:
# Solidity toolchain
npm install -g hardhat
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Python environment
python3 -m venv credflow-env
source credflow-env/bin/activate
pip install web3 python-dotenv torch torch-geometric \
            xgboost shap pandas numpy scikit-learn \
            langgraph langchain fastapi uvicorn \
            dune-client alchemy-sdk requests

# Frontend
npx create-next-app@latest frontend --typescript --tailwind
cd frontend && npm install wagmi viem @rainbow-me/rainbowkit recharts


PHASE 1 — Smart Contracts
Build and deploy contracts in this exact order. Each depends on the previous.

Contract 1 — CredScoreSBT.sol
This is the most important contract. Everything else reads from it.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

contract CredScoreSBT is AccessControl, Pausable, UUPSUpgradeable {

    bytes32 public constant SCORER_ROLE = keccak256("SCORER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    struct CreditProfile {
        uint16 score;              // 300-850
        uint16 gmxSubScore;        // 0-100
        uint16 fhenixSubScore;     // 0-100
        uint16 walletSubScore;     // 0-100
        uint8 loanStatus;          // 0=none, 1=active, 2=repaid, 3=defaulted
        uint8 totalLoans;
        uint8 defaultCount;
        uint32 lastUpdated;        // unix timestamp
        bool exists;
        bool loanActive;
        string shapeExplanationCID; // IPFS CID of SHAP breakdown
    }

    // wallet address => CreditProfile
    mapping(address => CreditProfile) public profiles;

    // wallet address => attestation proof hashes
    mapping(address => bytes32[]) public attestations;

    // events
    event SBTMinted(address indexed wallet, uint16 initialScore);
    event ScoreUpdated(address indexed wallet, uint16 oldScore, uint16 newScore);
    event LoanStatusUpdated(address indexed wallet, uint8 status);
    event DefaultRecorded(address indexed wallet, uint32 timestamp);
    event AttestationAdded(address indexed wallet, bytes32 proofHash);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // Called by Underwriter Agent after initial scoring
    function mintSBT(
        address wallet,
        uint16 score,
        uint16 gmxSub,
        uint16 fhenixSub,
        uint16 walletSub,
        string calldata shapCID
    ) external onlyRole(SCORER_ROLE) whenNotPaused {
        require(!profiles[wallet].exists, "SBT already exists");
        require(score >= 300 && score <= 850, "Invalid score range");

        profiles[wallet] = CreditProfile({
            score: score,
            gmxSubScore: gmxSub,
            fhenixSubScore: fhenixSub,
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

    // Called by Underwriter Agent after rescore
    function updateScore(
        address wallet,
        uint16 newScore,
        uint16 gmxSub,
        uint16 fhenixSub,
        uint16 walletSub,
        string calldata shapCID
    ) external onlyRole(SCORER_ROLE) {
        require(profiles[wallet].exists, "No SBT found");
        uint16 old = profiles[wallet].score;
        profiles[wallet].score = newScore;
        profiles[wallet].gmxSubScore = gmxSub;
        profiles[wallet].fhenixSubScore = fhenixSub;
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

    function addAttestation(
        address wallet,
        bytes32 proofHash
    ) external onlyRole(SCORER_ROLE) {
        attestations[wallet].push(proofHash);
        emit AttestationAdded(wallet, proofHash);
    }

    function getProfile(address wallet)
        external view returns (CreditProfile memory) {
        return profiles[wallet];
    }

    function hasProfile(address wallet) external view returns (bool) {
        return profiles[wallet].exists;
    }

    // SBT — block all transfers
    function _beforeTokenTransfer(address from, address, uint256, uint256)
        internal pure {
        require(from == address(0), "SBT: non-transferable");
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}


Contract 2 — CredFlowLending.sol
The core lending contract. Reads from CredScoreSBT for every operation.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CredScoreSBT.sol";
import "./interfaces/ILTVOracle.sol";

contract CredFlowLending is ReentrancyGuard, Pausable, AccessControl {

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    CredScoreSBT public sbtContract;
    ILTVOracle public priceOracle;   // Chainlink price feed
    IERC20 public usdc;

    // Score → max LTV (basis points, e.g. 6500 = 65%)
    // These are set at deploy and adjustable by governance
    uint16[6] public scoreTiers =  [500, 580, 620, 680, 720, 750];
    uint16[6] public ltvTiers   =  [4000, 5000, 6000, 6500, 7500, 8500];
    uint16[6] public ratePremiums= [700,  500,  400,  300,  200,  100]; // basis points over base

    uint256 public baseRate = 500; // 5% annual in basis points
    uint256 public liquidationThreshold = 8500; // 85%
    uint256 public liquidationPenalty = 500;    // 5%

    struct Loan {
        address borrower;
        address collateralToken;
        uint256 collateralAmount;
        uint256 borrowedAmount;
        uint256 interestRate;       // annualized, basis points
        uint256 startTime;
        uint256 dueTime;
        uint256 maxLTV;             // basis points
        bool active;
    }

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public activeLoanId;
    uint256 public loanCounter;

    event LoanCreated(uint256 indexed loanId, address borrower, uint256 amount, uint256 ltv);
    event LoanRepaid(uint256 indexed loanId, address borrower, uint256 totalRepaid);
    event LoanLiquidated(uint256 indexed loanId, address borrower, uint256 recovered);
    event HealthWarning(uint256 indexed loanId, address borrower, uint256 currentLTV);

    constructor(
        address _sbt,
        address _oracle,
        address _usdc,
        address admin
    ) {
        sbtContract = CredScoreSBT(_sbt);
        priceOracle = ILTVOracle(_oracle);
        usdc = IERC20(_usdc);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function requestLoan(
        uint256 borrowAmount,
        address collateralToken,
        uint256 collateralAmount,
        uint256 durationDays
    ) external nonReentrant whenNotPaused {
        require(sbtContract.hasProfile(msg.sender), "No credit profile");
        require(activeLoanId[msg.sender] == 0, "Existing loan active");

        CredScoreSBT.CreditProfile memory profile = sbtContract.getProfile(msg.sender);
        require(profile.defaultCount == 0, "Prior default on record");
        require(!profile.loanActive, "Loan already active");

        // Calculate max LTV from score
        uint16 maxLTV = getLTVForScore(profile.score);
        uint256 interestRate = getRateForScore(profile.score);

        // Verify collateral covers borrow at this LTV
        uint256 collateralValueUSD = priceOracle.getValueUSD(
            collateralToken, collateralAmount
        );
        uint256 maxBorrow = (collateralValueUSD * maxLTV) / 10000;
        require(borrowAmount <= maxBorrow, "Exceeds max LTV");
        require(usdc.balanceOf(address(this)) >= borrowAmount, "Insufficient pool");

        // Take collateral
        IERC20(collateralToken).transferFrom(
            msg.sender, address(this), collateralAmount
        );

        // Create loan
        loanCounter++;
        loans[loanCounter] = Loan({
            borrower: msg.sender,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            borrowedAmount: borrowAmount,
            interestRate: interestRate,
            startTime: block.timestamp,
            dueTime: block.timestamp + (durationDays * 1 days),
            maxLTV: maxLTV,
            active: true
        });

        activeLoanId[msg.sender] = loanCounter;
        sbtContract.setLoanActive(msg.sender);
        usdc.transfer(msg.sender, borrowAmount);

        emit LoanCreated(loanCounter, msg.sender, borrowAmount, maxLTV);
    }

    function repayLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.borrower == msg.sender, "Not borrower");
        require(loan.active, "Loan not active");

        uint256 interest = calculateInterest(loan);
        uint256 totalRepay = loan.borrowedAmount + interest;

        usdc.transferFrom(msg.sender, address(this), totalRepay);
        IERC20(loan.collateralToken).transfer(msg.sender, loan.collateralAmount);

        loan.active = false;
        activeLoanId[msg.sender] = 0;
        sbtContract.setLoanRepaid(msg.sender);

        emit LoanRepaid(loanId, msg.sender, totalRepay);
    }

    // Called by Liquidation Agent
    function liquidate(uint256 loanId) external onlyRole(AGENT_ROLE) nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Not active");

        uint256 currentLTV = getCurrentLTV(loanId);
        require(currentLTV >= liquidationThreshold, "Not liquidatable");

        uint256 collateralValue = priceOracle.getValueUSD(
            loan.collateralToken, loan.collateralAmount
        );
        uint256 interest = calculateInterest(loan);
        uint256 totalOwed = loan.borrowedAmount + interest;
        uint256 penalty = (totalOwed * liquidationPenalty) / 10000;
        uint256 totalToRecover = totalOwed + penalty;

        // Partial or full liquidation
        uint256 recovered = collateralValue >= totalToRecover
            ? totalToRecover : collateralValue;

        loan.active = false;
        activeLoanId[loan.borrower] = 0;
        sbtContract.recordDefault(loan.borrower);

        emit LoanLiquidated(loanId, loan.borrower, recovered);
    }

    // Called by Portfolio Monitor Agent
    function emitHealthWarning(uint256 loanId) external onlyRole(AGENT_ROLE) {
        uint256 currentLTV = getCurrentLTV(loanId);
        emit HealthWarning(loanId, loans[loanId].borrower, currentLTV);
    }

    function getCurrentLTV(uint256 loanId) public view returns (uint256) {
        Loan memory loan = loans[loanId];
        uint256 collateralValue = priceOracle.getValueUSD(
            loan.collateralToken, loan.collateralAmount
        );
        uint256 interest = calculateInterest(loan);
        return ((loan.borrowedAmount + interest) * 10000) / collateralValue;
    }

    function calculateInterest(Loan memory loan) public view returns (uint256) {
        uint256 elapsed = block.timestamp - loan.startTime;
        return (loan.borrowedAmount * loan.interestRate * elapsed)
            / (10000 * 365 days);
    }

    function getLTVForScore(uint16 score) public view returns (uint16) {
        for (uint i = scoreTiers.length; i > 0; i--) {
            if (score >= scoreTiers[i-1]) return ltvTiers[i-1];
        }
        return 0; // below minimum score
    }

    function getRateForScore(uint16 score) public view returns (uint256) {
        for (uint i = scoreTiers.length; i > 0; i--) {
            if (score >= scoreTiers[i-1]) {
                return baseRate + ratePremiums[i-1];
            }
        }
        return baseRate + 1000; // max premium for very low scores
    }
}


Contract 3 — CredFlowOApp.sol (LayerZero)
Handles all cross-chain messaging. Inherits LayerZero's OApp standard.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CredScoreSBT.sol";

contract CredFlowOApp is OApp, AccessControl {

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    CredScoreSBT public sbtContract;

    // Message types
    uint8 constant MSG_SCORE_UPDATE = 1;
    uint8 constant MSG_LOAN_ACTIVE  = 2;
    uint8 constant MSG_DEFAULT      = 3;
    uint8 constant MSG_REPAID       = 4;

    // Spoke chain score mirror: wallet => score
    mapping(address => uint16) public spokeScores;
    mapping(address => bool) public defaultBlacklist;

    event ScoreReceived(address indexed wallet, uint16 score, uint32 srcChain);
    event DefaultReceived(address indexed wallet, uint32 srcChain);

    constructor(
        address _endpoint,
        address _sbt,
        address admin
    ) OApp(_endpoint, admin) {
        sbtContract = CredScoreSBT(_sbt);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // Called by Cross-Chain Sync Agent on hub chain (Robinhood)
    function broadcastScore(
        uint32[] calldata dstChainIds,
        address wallet,
        uint16 score,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_SCORE_UPDATE, wallet, score);
        for (uint i = 0; i < dstChainIds.length; i++) {
            _lzSend(dstChainIds[i], payload, options, MessagingFee(msg.value / dstChainIds.length, 0), payable(msg.sender));
        }
    }

    // Urgent — called immediately on default
    function broadcastDefault(
        uint32[] calldata dstChainIds,
        address wallet,
        bytes calldata options
    ) external payable onlyRole(AGENT_ROLE) {
        bytes memory payload = abi.encode(MSG_DEFAULT, wallet, uint16(310));
        for (uint i = 0; i < dstChainIds.length; i++) {
            _lzSend(dstChainIds[i], payload, options, MessagingFee(msg.value / dstChainIds.length, 0), payable(msg.sender));
        }
    }

    // Receives messages on spoke chains
    function _lzReceive(
        Origin calldata origin,
        bytes32,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        (uint8 msgType, address wallet, uint16 score) =
            abi.decode(message, (uint8, address, uint16));

        if (msgType == MSG_SCORE_UPDATE) {
            spokeScores[wallet] = score;
            emit ScoreReceived(wallet, score, origin.srcEid);
        } else if (msgType == MSG_DEFAULT) {
            defaultBlacklist[wallet] = true;
            spokeScores[wallet] = 310;
            emit DefaultReceived(wallet, origin.srcEid);
        }
    }

    function getScore(address wallet) external view returns (uint16) {
        return spokeScores[wallet];
    }

    function isBlacklisted(address wallet) external view returns (bool) {
        return defaultBlacklist[wallet];
    }
}


Contract 4 — LiquidityPool.sol
Where lenders deposit USDC to fund loans.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// LP receipt token — represents lender's share of pool
contract CredFlowLP is ERC20, ReentrancyGuard, Ownable {

    IERC20 public usdc;
    address public lendingContract;

    uint256 public totalDeposited;
    uint256 public totalBorrowed;

    event Deposited(address indexed lender, uint256 amount, uint256 lpMinted);
    event Withdrawn(address indexed lender, uint256 lpBurned, uint256 usdcReturned);

    constructor(address _usdc) ERC20("CredFlow LP", "cfUSDC") {
        usdc = IERC20(_usdc);
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        uint256 lpToMint = totalSupply() == 0
            ? amount
            : (amount * totalSupply()) / totalDeposited;

        usdc.transferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        _mint(msg.sender, lpToMint);

        emit Deposited(msg.sender, amount, lpToMint);
    }

    function withdraw(uint256 lpAmount) external nonReentrant {
        require(lpAmount <= balanceOf(msg.sender), "Insufficient LP");
        uint256 usdcAmount = (lpAmount * totalDeposited) / totalSupply();
        require(usdcAmount <= availableLiquidity(), "Insufficient liquidity");

        _burn(msg.sender, lpAmount);
        totalDeposited -= usdcAmount;
        usdc.transfer(msg.sender, usdcAmount);

        emit Withdrawn(msg.sender, lpAmount, usdcAmount);
    }

    function availableLiquidity() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function utilizationRate() public view returns (uint256) {
        if (totalDeposited == 0) return 0;
        return (totalBorrowed * 10000) / totalDeposited;
    }
}


Deployment Script
// scripts/deploy.js
const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with:", deployer.address);

    // 1. Deploy SBT
    const SBT = await ethers.getContractFactory("CredScoreSBT");
    const sbt = await SBT.deploy(deployer.address);
    await sbt.waitForDeployment();
    console.log("SBT deployed:", await sbt.getAddress());

    // 2. Deploy Liquidity Pool
    const USDC_ADDRESS = process.env.USDC_ROBINHOOD;
    const Pool = await ethers.getContractFactory("CredFlowLP");
    const pool = await Pool.deploy(USDC_ADDRESS);
    await pool.waitForDeployment();

    // 3. Deploy Lending Contract
    const ORACLE_ADDRESS = process.env.PRICE_ORACLE;
    const Lending = await ethers.getContractFactory("CredFlowLending");
    const lending = await Lending.deploy(
        await sbt.getAddress(),
        ORACLE_ADDRESS,
        USDC_ADDRESS,
        deployer.address
    );
    await lending.waitForDeployment();
    console.log("Lending deployed:", await lending.getAddress());

    // 4. Deploy OApp
    const LZ_ENDPOINT = process.env.LAYERZERO_ENDPOINT_ROBINHOOD;
    const OApp = await ethers.getContractFactory("CredFlowOApp");
    const oapp = await OApp.deploy(
        LZ_ENDPOINT,
        await sbt.getAddress(),
        deployer.address
    );
    await oapp.waitForDeployment();
    console.log("OApp deployed:", await oapp.getAddress());

    // 5. Grant roles
    const SCORER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SCORER_ROLE"));
    const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AGENT_ROLE"));
    const AGENT_WALLET = process.env.AGENT_WALLET_ADDRESS;

    await sbt.grantRole(SCORER_ROLE, AGENT_WALLET);
    await sbt.grantRole(AGENT_ROLE, AGENT_WALLET);
    await lending.grantRole(AGENT_ROLE, AGENT_WALLET);
    await oapp.grantRole(AGENT_ROLE, AGENT_WALLET);

    // Save addresses
    const addresses = {
        sbt: await sbt.getAddress(),
        lending: await lending.getAddress(),
        pool: await pool.getAddress(),
        oapp: await oapp.getAddress(),
    };

    require("fs").writeFileSync(
        "./docs/addresses.json",
        JSON.stringify(addresses, null, 2)
    );
}

main().catch(console.error);


PHASE 2 — ML Pipeline
Build in this order: data collection → feature engineering → model training → serving API.

Step 2.1 — Dune Data Pipeline
# indexer/dune_pipeline.py
from dune_client.client import DuneClient
from dune_client.query import QueryBase
import pandas as pd
import os

client = DuneClient(os.environ["DUNE_API_KEY"])

# Query 1: Aave repayment history on Arbitrum
AAVE_QUERY = """
SELECT
    borrower,
    COUNT(*) as total_borrows,
    SUM(CASE WHEN repaid_on_time THEN 1 ELSE 0 END) as on_time_repayments,
    SUM(CASE WHEN liquidated THEN 1 ELSE 0 END) as liquidation_count,
    AVG(loan_duration_days) as avg_loan_duration,
    MAX(borrow_amount_usd) as max_borrow_usd,
    MIN(block_time) as first_borrow_date
FROM aave_v3_arbitrum.borrows
GROUP BY borrower
"""

# Query 2: GMX trading history
GMX_QUERY = """
SELECT
    account,
    COUNT(*) as total_positions,
    SUM(CASE WHEN is_liquidated THEN 1 ELSE 0 END) as liquidations,
    AVG(leverage) as avg_leverage,
    AVG(position_duration_hours) as avg_hold_hours,
    SUM(realized_pnl_usd) as total_pnl,
    MIN(block_time) as first_trade_date
FROM gmx_v2_arbitrum.positions
GROUP BY account
"""

# Query 3: General wallet behavior
WALLET_QUERY = """
SELECT
    "from" as wallet,
    COUNT(DISTINCT to) as unique_protocols,
    COUNT(*) as tx_count,
    MIN(block_time) as wallet_first_seen,
    MAX(block_time) as wallet_last_active
FROM arbitrum.transactions
WHERE "from" = '{{wallet_address}}'
GROUP BY "from"
"""

def fetch_training_data():
    """Fetch all historical data for model training"""
    aave_result = client.run_query(QueryBase(query_sql=AAVE_QUERY))
    gmx_result = client.run_query(QueryBase(query_sql=GMX_QUERY))

    aave_df = pd.DataFrame(aave_result.result.rows)
    gmx_df = pd.DataFrame(gmx_result.result.rows)

    return aave_df, gmx_df

def fetch_wallet_features(wallet_address: str) -> dict:
    """Fetch features for a single wallet at underwriting time"""
    query = QueryBase(
        query_sql=WALLET_QUERY,
        params=[{"name": "wallet_address", "value": wallet_address}]
    )
    result = client.run_query(query)
    rows = result.result.rows
    return rows[0] if rows else {}


Step 2.2 — Alchemy Real-Time Data
# indexer/alchemy_pipeline.py
from web3 import Web3
import requests
import os

ALCHEMY_KEY = os.environ["ALCHEMY_API_KEY"]
ALCHEMY_URL = f"https://arb-mainnet.g.alchemy.com/v2/{ALCHEMY_KEY}"

w3 = Web3(Web3.HTTPProvider(ALCHEMY_URL))

def get_wallet_state(wallet_address: str) -> dict:
    """Pull current wallet state for underwriting"""
    checksum = Web3.to_checksum_address(wallet_address)

    eth_balance = w3.eth.get_balance(checksum)

    # Token balances via Alchemy API
    response = requests.post(ALCHEMY_URL, json={
        "jsonrpc": "2.0",
        "method": "alchemy_getTokenBalances",
        "params": [checksum],
        "id": 1
    })
    token_balances = response.json().get("result", {})

    # Transaction count (nonce = proxy for activity)
    tx_count = w3.eth.get_transaction_count(checksum)

    # Recent transactions
    tx_response = requests.post(ALCHEMY_URL, json={
        "jsonrpc": "2.0",
        "method": "alchemy_getAssetTransfers",
        "params": [{
            "fromAddress": checksum,
            "maxCount": "0x64",  # last 100 txs
            "category": ["external", "erc20", "erc721"]
        }],
        "id": 1
    })
    recent_txs = tx_response.json().get("result", {}).get("transfers", [])

    return {
        "eth_balance_wei": eth_balance,
        "tx_count": tx_count,
        "token_balances": token_balances,
        "recent_transactions": recent_txs,
    }

def setup_webhook(wallet_address: str, webhook_url: str):
    """Subscribe to wallet activity for Portfolio Monitor Agent"""
    response = requests.post(
        "https://dashboard.alchemy.com/api/create-webhook",
        headers={"X-Alchemy-Token": ALCHEMY_KEY},
        json={
            "network": "ARB_MAINNET",
            "webhook_type": "ADDRESS_ACTIVITY",
            "webhook_url": webhook_url,
            "addresses": [wallet_address]
        }
    )
    return response.json()


Step 2.3 — GMX Sub-Module
# indexer/gmx_module.py
import requests

GMX_SUBGRAPH = "https://api.thegraph.com/subgraphs/name/gmx-io/gmx-stats"

def fetch_gmx_history(wallet_address: str) -> dict:
    query = """
    {
      positions(where: {account: "%s"}) {
        account
        collateral
        size
        leverage
        isLong
        averagePrice
        createdAt
        closedAt
        realisedPnl
        isLiquidated
      }
    }
    """ % wallet_address.lower()

    response = requests.post(GMX_SUBGRAPH, json={"query": query})
    positions = response.json().get("data", {}).get("positions", [])

    if not positions:
        return {"has_gmx_history": False, "gmx_sub_score": 50}

    total = len(positions)
    liquidations = sum(1 for p in positions if p.get("isLiquidated"))
    avg_leverage = sum(float(p.get("leverage", 0)) for p in positions) / total

    # Duration in days
    durations = []
    for p in positions:
        if p.get("closedAt") and p.get("createdAt"):
            d = (int(p["closedAt"]) - int(p["createdAt"])) / 86400
            durations.append(d)
    avg_duration = sum(durations) / len(durations) if durations else 0

    total_pnl = sum(float(p.get("realisedPnl", 0)) for p in positions)

    # Score calculation
    liq_penalty = liquidations * 15
    leverage_penalty = max(0, (avg_leverage - 5) * 2)
    duration_bonus = min(20, avg_duration * 0.5)
    pnl_bonus = min(10, max(-10, total_pnl / 1000))
    experience_bonus = min(15, total * 0.5)

    raw_score = 70 - liq_penalty - leverage_penalty + duration_bonus + pnl_bonus + experience_bonus
    final_score = max(0, min(100, raw_score))

    return {
        "has_gmx_history": True,
        "total_positions": total,
        "liquidation_count": liquidations,
        "avg_leverage": avg_leverage,
        "avg_duration_days": avg_duration,
        "total_pnl_usd": total_pnl,
        "gmx_sub_score": round(final_score)
    }


Step 2.4 — Feature Engineering
# ml/feature_engineering.py
import pandas as pd
import numpy as np
from datetime import datetime

def build_feature_vector(
    wallet_address: str,
    dune_aave: dict,
    dune_wallet: dict,
    alchemy_state: dict,
    gmx_data: dict,
    fhenix_attestation: dict
) -> dict:
    """
    Combines all data sources into the feature vector
    the XGBoost model expects. Every field must be present
    even if zero — the model was trained on this exact schema.
    """
    now = datetime.now().timestamp()

    # --- Wallet age ---
    first_seen = dune_wallet.get("wallet_first_seen")
    wallet_age_days = (now - pd.Timestamp(first_seen).timestamp()) / 86400 \
        if first_seen else 0

    # --- Repayment signals ---
    total_borrows = dune_aave.get("total_borrows", 0)
    on_time = dune_aave.get("on_time_repayments", 0)
    repayment_rate = on_time / total_borrows if total_borrows > 0 else 0.5
    liquidation_count = dune_aave.get("liquidation_count", 0)

    # --- Asset signals ---
    eth_balance = int(alchemy_state.get("eth_balance_wei", 0)) / 1e18
    tx_count = alchemy_state.get("tx_count", 0)
    protocol_diversity = dune_wallet.get("unique_protocols", 0)

    # --- GMX signals ---
    gmx_sub_score = gmx_data.get("gmx_sub_score", 50)
    gmx_liquidations = gmx_data.get("liquidation_count", 0)
    gmx_avg_leverage = gmx_data.get("avg_leverage", 0)
    gmx_total_positions = gmx_data.get("total_positions", 0)

    # --- Fhenix attestation signals ---
    # These are boolean/threshold results from FHE proofs
    fhenix_income_verified = fhenix_attestation.get("income_above_threshold", False)
    fhenix_balance_verified = fhenix_attestation.get("balance_above_threshold", False)
    fhenix_repayment_clean = fhenix_attestation.get("repayment_history_clean", False)
    fhenix_account_age_years = fhenix_attestation.get("account_age_years", 0)

    return {
        # Wallet behavior
        "wallet_age_days": wallet_age_days,
        "tx_count": tx_count,
        "protocol_diversity": protocol_diversity,

        # Repayment history
        "total_borrows": total_borrows,
        "repayment_rate": repayment_rate,
        "defi_liquidation_count": liquidation_count,
        "avg_loan_duration_days": dune_aave.get("avg_loan_duration", 0),

        # Asset health
        "eth_balance": eth_balance,

        # GMX signals
        "gmx_sub_score": gmx_sub_score,
        "gmx_liquidation_count": gmx_liquidations,
        "gmx_avg_leverage": gmx_avg_leverage,
        "gmx_total_positions": gmx_total_positions,
        "has_gmx_history": int(gmx_data.get("has_gmx_history", False)),

        # Fhenix attestation
        "fhenix_income_verified": int(fhenix_income_verified),
        "fhenix_balance_verified": int(fhenix_balance_verified),
        "fhenix_repayment_clean": int(fhenix_repayment_clean),
        "fhenix_account_age_years": fhenix_account_age_years,
    }


Step 2.5 — Model Training
# ml/train_model.py
import xgboost as xgb
import shap
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
import joblib
import json

def train_credflow_model(training_data_path: str):
    """
    Train on historical Aave/Compound data.
    Label: 1 = defaulted/liquidated, 0 = repaid cleanly.
    Features: all columns in build_feature_vector output.
    """
    df = pd.read_csv(training_data_path)

    FEATURES = [
        "wallet_age_days", "tx_count", "protocol_diversity",
        "total_borrows", "repayment_rate", "defi_liquidation_count",
        "avg_loan_duration_days", "eth_balance",
        "gmx_sub_score", "gmx_liquidation_count", "gmx_avg_leverage",
        "gmx_total_positions", "has_gmx_history",
        "fhenix_income_verified", "fhenix_balance_verified",
        "fhenix_repayment_clean", "fhenix_account_age_years",
    ]

    X = df[FEATURES]
    y = df["defaulted"]  # 1 if defaulted, 0 if repaid

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=(y == 0).sum() / (y == 1).sum(),  # handle imbalance
        use_label_encoder=False,
        eval_metric="auc",
        early_stopping_rounds=50,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=100
    )

    y_pred_proba = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, y_pred_proba)
    print(f"Test AUC-ROC: {auc:.4f}")

    # Save model
    joblib.dump(model, "ml/credflow_model.pkl")

    # SHAP explainer
    explainer = shap.TreeExplainer(model)
    joblib.dump(explainer, "ml/credflow_explainer.pkl")

    return model, explainer

def score_wallet(feature_vector: dict) -> dict:
    """
    Convert XGBoost default probability to CredScore (300-850).
    0% default probability → 850. 100% → 300.
    """
    model = joblib.load("ml/credflow_model.pkl")
    explainer = joblib.load("ml/credflow_explainer.pkl")

    FEATURES = [
        "wallet_age_days", "tx_count", "protocol_diversity",
        "total_borrows", "repayment_rate", "defi_liquidation_count",
        "avg_loan_duration_days", "eth_balance",
        "gmx_sub_score", "gmx_liquidation_count", "gmx_avg_leverage",
        "gmx_total_positions", "has_gmx_history",
        "fhenix_income_verified", "fhenix_balance_verified",
        "fhenix_repayment_clean", "fhenix_account_age_years",
    ]

    X = pd.DataFrame([feature_vector])[FEATURES]

    # Default probability
    default_prob = model.predict_proba(X)[0][1]

    # Map to 300-850 range
    cred_score = int(300 + (1 - default_prob) * 550)
    cred_score = max(300, min(850, cred_score))

    # SHAP explanation
    shap_values = explainer.shap_values(X)
    shap_dict = {
        feat: float(shap_values[0][i])
        for i, feat in enumerate(FEATURES)
    }

    # Sub-scores (weighted averages of SHAP groups)
    gmx_features = ["gmx_sub_score", "gmx_liquidation_count",
                     "gmx_avg_leverage", "gmx_total_positions"]
    fhenix_features = ["fhenix_income_verified", "fhenix_balance_verified",
                        "fhenix_repayment_clean", "fhenix_account_age_years"]
    wallet_features = ["wallet_age_days", "tx_count", "protocol_diversity",
                        "total_borrows", "repayment_rate", "defi_liquidation_count"]

    def group_sub_score(features):
        total = sum(shap_dict.get(f, 0) for f in features)
        return max(0, min(100, int(50 + total * 100)))

    return {
        "cred_score": cred_score,
        "default_probability": round(default_prob, 4),
        "gmx_sub_score": group_sub_score(gmx_features),
        "fhenix_sub_score": group_sub_score(fhenix_features),
        "wallet_sub_score": group_sub_score(wallet_features),
        "shap_values": shap_dict,
    }


Step 2.6 — Scoring API
# ml/scoring_api.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from indexer.dune_pipeline import fetch_wallet_features
from indexer.alchemy_pipeline import get_wallet_state
from indexer.gmx_module import fetch_gmx_history
from ml.feature_engineering import build_feature_vector
from ml.train_model import score_wallet
import json, ipfshttpclient

app = FastAPI()

class ScoreRequest(BaseModel):
    wallet_address: str
    fhenix_attestation: dict  # passed from frontend after FHE flow

@app.post("/score")
async def score_wallet_endpoint(req: ScoreRequest):
    try:
        # Fetch all data in parallel (use asyncio.gather in production)
        dune_aave = fetch_wallet_features(req.wallet_address)
        alchemy_state = get_wallet_state(req.wallet_address)
        gmx_data = fetch_gmx_history(req.wallet_address)

        # Build feature vector
        features = build_feature_vector(
            wallet_address=req.wallet_address,
            dune_aave=dune_aave,
            dune_wallet=dune_aave,
            alchemy_state=alchemy_state,
            gmx_data=gmx_data,
            fhenix_attestation=req.fhenix_attestation
        )

        # Score
        result = score_wallet(features)

        # Upload SHAP to IPFS
        client = ipfshttpclient.connect()
        shap_cid = client.add_json(result["shap_values"])

        return {
            **result,
            "shap_cid": shap_cid,
            "features_used": features
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


PHASE 3 — AI Agents
Each agent is a separate Python process. They share the web3 connection and contract ABIs.

Agent Base Setup
# agents/base.py
from web3 import Web3
from eth_account import Account
import json, os

class CredFlowAgent:
    def __init__(self):
        self.w3 = Web3(Web3.HTTPProvider(os.environ["RPC_ROBINHOOD"]))
        self.account = Account.from_key(os.environ["AGENT_PRIVATE_KEY"])

        with open("docs/addresses.json") as f:
            self.addresses = json.load(f)

        with open("docs/abis/CredScoreSBT.json") as f:
            self.sbt = self.w3.eth.contract(
                address=self.addresses["sbt"],
                abi=json.load(f)
            )

        with open("docs/abis/CredFlowLending.json") as f:
            self.lending = self.w3.eth.contract(
                address=self.addresses["lending"],
                abi=json.load(f)
            )

        with open("docs/abis/CredFlowOApp.json") as f:
            self.oapp = self.w3.eth.contract(
                address=self.addresses["oapp"],
                abi=json.load(f)
            )

    def send_tx(self, fn):
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 500000,
            "gasPrice": self.w3.eth.gas_price
        })
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
        return self.w3.eth.wait_for_transaction_receipt(tx_hash)


Agent 1 — Underwriter Agent
# agents/underwriter_agent.py
import requests
from agents.base import CredFlowAgent

class UnderwriterAgent(CredFlowAgent):

    SCORING_API = "http://localhost:8000/score"

    def underwrite(self, wallet_address: str, fhenix_attestation: dict) -> dict:
        print(f"[Underwriter] Starting underwriting for {wallet_address}")

        # Check if already has SBT
        has_profile = self.sbt.functions.hasProfile(wallet_address).call()

        # Call scoring API
        response = requests.post(self.SCORING_API, json={
            "wallet_address": wallet_address,
            "fhenix_attestation": fhenix_attestation
        })
        score_result = response.json()

        cred_score = score_result["cred_score"]
        print(f"[Underwriter] CredScore: {cred_score}")

        if not has_profile:
            # Mint new SBT
            receipt = self.send_tx(
                self.sbt.functions.mintSBT(
                    wallet_address,
                    cred_score,
                    score_result["gmx_sub_score"],
                    score_result["fhenix_sub_score"],
                    score_result["wallet_sub_score"],
                    score_result["shap_cid"]
                )
            )
            print(f"[Underwriter] SBT minted. TX: {receipt.transactionHash.hex()}")
        else:
            # Update existing score
            receipt = self.send_tx(
                self.sbt.functions.updateScore(
                    wallet_address,
                    cred_score,
                    score_result["gmx_sub_score"],
                    score_result["fhenix_sub_score"],
                    score_result["wallet_sub_score"],
                    score_result["shap_cid"]
                )
            )

        return {
            "approved": cred_score >= 500,
            "cred_score": cred_score,
            "max_ltv": self.lending.functions.getLTVForScore(cred_score).call(),
            "interest_rate": self.lending.functions.getRateForScore(cred_score).call(),
            "shap_explanation": score_result["shap_values"],
        }


Agent 2 — Portfolio Monitor Agent
# agents/portfolio_monitor.py
from agents.base import CredFlowAgent
from web3 import Web3
import time

class PortfolioMonitorAgent(CredFlowAgent):

    HEALTH_WARNING_LTV = 7500   # 75% — warn before 85% liquidation threshold
    CHECK_INTERVAL = 12         # seconds (every block approx)

    def run(self):
        print("[Monitor] Portfolio Monitor Agent started")
        while True:
            self.check_all_active_loans()
            time.sleep(self.CHECK_INTERVAL)

    def check_all_active_loans(self):
        # Scan LoanCreated events for active loans
        loan_created_filter = self.lending.events.LoanCreated.create_filter(
            fromBlock="earliest"
        )
        events = loan_created_filter.get_all_entries()

        for event in events:
            loan_id = event["args"]["loanId"]
            loan = self.lending.functions.loans(loan_id).call()

            if not loan[8]:  # active flag
                continue

            current_ltv = self.lending.functions.getCurrentLTV(loan_id).call()

            if current_ltv >= self.HEALTH_WARNING_LTV:
                print(f"[Monitor] Health warning for loan {loan_id}. LTV: {current_ltv/100}%")
                self.send_tx(
                    self.lending.functions.emitHealthWarning(loan_id)
                )

            # Check for overdue loans
            borrower = loan[0]
            due_time = loan[6]
            if time.time() > due_time and loan[8]:
                print(f"[Monitor] Loan {loan_id} overdue. Alerting Liquidation Agent.")
                # In production: trigger liquidation agent via message queue


Agent 3 — Liquidation Agent
# agents/liquidation_agent.py
from agents.base import CredFlowAgent

class LiquidationAgent(CredFlowAgent):

    GRACE_PERIOD_SECONDS = 48 * 3600  # 48 hours

    def attempt_recovery(self, loan_id: int):
        """Soft recovery first — emit covenant breach, wait 48h"""
        loan = self.lending.functions.loans(loan_id).call()
        borrower = loan[0]
        print(f"[Liquidator] Covenant breach for {borrower}. Grace period: 48h")
        # Emit on-chain event — handled by frontend to notify borrower
        # Wait for grace period in production via scheduler

    def execute_liquidation(self, loan_id: int):
        """Hard liquidation after grace period"""
        current_ltv = self.lending.functions.getCurrentLTV(loan_id).call()

        if current_ltv < 8500:
            print(f"[Liquidator] LTV recovered ({current_ltv/100}%). No liquidation needed.")
            return

        print(f"[Liquidator] Executing liquidation for loan {loan_id}")
        receipt = self.send_tx(
            self.lending.functions.liquidate(loan_id)
        )
        print(f"[Liquidator] Liquidation TX: {receipt.transactionHash.hex()}")

        # Get borrower address
        loan = self.lending.functions.loans(loan_id).call()
        borrower = loan[0]

        # Immediately broadcast default cross-chain
        self.broadcast_default(borrower)

    def broadcast_default(self, wallet_address: str):
        """Urgent LayerZero broadcast to all spoke chains"""
        dst_chains = [
            int(os.environ["LZ_CHAIN_ID_ARBITRUM"]),
            int(os.environ["LZ_CHAIN_ID_BASE"]),
        ]
        print(f"[Liquidator] Broadcasting default for {wallet_address} to {dst_chains}")
        receipt = self.send_tx(
            self.oapp.functions.broadcastDefault(
                dst_chains,
                wallet_address,
                b""  # options — use default
            )
        )
        print(f"[Liquidator] Default broadcast TX: {receipt.transactionHash.hex()}")


Agent 4 — Cross-Chain Sync Agent
# agents/crosschain_sync.py
from agents.base import CredFlowAgent
import time, os

class CrossChainSyncAgent(CredFlowAgent):

    SYNC_INTERVAL = 4 * 3600  # every 4 hours

    def run(self):
        print("[Sync] Cross-Chain Sync Agent started")
        while True:
            self.sync_all_scores()
            time.sleep(self.SYNC_INTERVAL)

    def sync_all_scores(self):
        """Broadcast all updated scores since last sync to all spoke chains"""
        print("[Sync] Starting score sync cycle")

        # Get all ScoreUpdated and SBTMinted events since last sync
        score_filter = self.sbt.events.ScoreUpdated.create_filter(
            fromBlock=self.get_last_sync_block()
        )
        mint_filter = self.sbt.events.SBTMinted.create_filter(
            fromBlock=self.get_last_sync_block()
        )

        updated_wallets = {}
        for e in score_filter.get_all_entries():
            updated_wallets[e["args"]["wallet"]] = e["args"]["newScore"]
        for e in mint_filter.get_all_entries():
            updated_wallets[e["args"]["wallet"]] = e["args"]["initialScore"]

        if not updated_wallets:
            print("[Sync] No updates to broadcast")
            return

        dst_chains = [
            int(os.environ["LZ_CHAIN_ID_ARBITRUM"]),
            int(os.environ["LZ_CHAIN_ID_BASE"]),
        ]

        for wallet, score in updated_wallets.items():
            print(f"[Sync] Broadcasting {wallet}: {score}")
            self.send_tx(
                self.oapp.functions.broadcastScore(
                    dst_chains,
                    wallet,
                    score,
                    b""
                )
            )

        self.save_last_sync_block(self.w3.eth.block_number)

    def get_last_sync_block(self):
        try:
            with open(".last_sync_block") as f:
                return int(f.read())
        except:
            return 0

    def save_last_sync_block(self, block):
        with open(".last_sync_block", "w") as f:
            f.write(str(block))


Agent 5 — Rate Optimizer Agent
# agents/rate_optimizer.py
from agents.base import CredFlowAgent
import time

class RateOptimizerAgent(CredFlowAgent):

    TARGET_UTILIZATION = 8000   # 80% target utilization
    OPTIMIZE_INTERVAL = 3600    # every hour

    def run(self):
        while True:
            self.optimize_rates()
            time.sleep(self.OPTIMIZE_INTERVAL)

    def optimize_rates(self):
        pool_address = self.addresses["pool"]

        # Read pool state
        # In production: call pool contract for utilization
        utilization = self.get_pool_utilization()
        print(f"[RateOptimizer] Current utilization: {utilization/100}%")

        if utilization > self.TARGET_UTILIZATION:
            # Too much demand, increase base rate to attract lenders
            new_base_rate = self.lending.functions.baseRate().call() + 25
            print(f"[RateOptimizer] Increasing base rate to {new_base_rate} bps")
            # Call governance/admin function to update rate
        elif utilization < 5000:
            # Too little demand, decrease rate to attract borrowers
            new_base_rate = max(200, self.lending.functions.baseRate().call() - 25)
            print(f"[RateOptimizer] Decreasing base rate to {new_base_rate} bps")

    def get_pool_utilization(self):
        # Read from LiquidityPool contract
        pass


PHASE 4 — Fhenix FHE Integration
This is the off-chain attestation flow. Most of the work is client-side.
// frontend/lib/fhenix.ts
import { BrowserProvider } from 'ethers';

export interface FhenixAttestation {
  income_above_threshold: boolean;
  balance_above_threshold: boolean;
  repayment_history_clean: boolean;
  account_age_years: number;
  proof_hash: string;
  timestamp: number;
}

export async function runFhenixAttestation(
  source: 'bank' | 'cex',
  connectionData: {
    accessToken: string;
    accountId: string;
  }
): Promise<FhenixAttestation> {

  // 1. Connect to Fhenix FHE node
  const fhenixEndpoint = process.env.NEXT_PUBLIC_FHENIX_ENDPOINT!;

  // 2. Send encrypted data to Fhenix
  // Data is encrypted on the client BEFORE being sent
  // Fhenix evaluates thresholds homomorphically
  const response = await fetch(`${fhenixEndpoint}/attest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      encrypted_payload: connectionData, // Fhenix SDK encrypts this
      thresholds: {
        income_threshold_usd: 2000,
        balance_threshold_usd: 4000,
        min_account_age_months: 12,
      }
    })
  });

  const attestation = await response.json();

  // 3. Return threshold results — no raw data
  return {
    income_above_threshold: attestation.income_verified,
    balance_above_threshold: attestation.balance_verified,
    repayment_history_clean: attestation.repayment_clean,
    account_age_years: attestation.account_age_years,
    proof_hash: attestation.proof_hash,
    timestamp: Date.now()
  };
}

// Post proof hash to Robinhood Chain contract
export async function postAttestationOnChain(
  proofHash: string,
  walletAddress: string,
  sbtContract: any
) {
  const hashBytes = ethers.utils.hexlify(
    ethers.utils.toUtf8Bytes(proofHash)
  );
  await sbtContract.addAttestation(walletAddress, hashBytes);
}


PHASE 5 — Frontend

Wagmi Config
// frontend/lib/wagmi.ts
import { createConfig, http } from 'wagmi';
import { arbitrumSepolia } from 'wagmi/chains';
import { injected, metaMask } from 'wagmi/connectors';

// Define Robinhood Chain
const robinhoodChain = {
  id: Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID),
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_ROBINHOOD!] }
  },
};

export const config = createConfig({
  chains: [robinhoodChain, arbitrumSepolia],
  connectors: [injected(), metaMask()],
  transports: {
    [robinhoodChain.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
});


Main Dashboard Page
// frontend/app/page.tsx
'use client';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useEffect, useState } from 'react';
import { getCreditProfile } from '@/lib/contracts';
import ScoreDashboard from '@/components/ScoreDashboard';
import LoanPanel from '@/components/LoanPanel';
import OnboardingFlow from '@/components/OnboardingFlow';

export default function Home() {
  const { address, isConnected } = useAccount();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    getCreditProfile(address)
      .then(setProfile)
      .finally(() => setLoading(false));
  }, [address]);

  if (!isConnected) return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-4xl font-bold mb-8">CredFlow</h1>
      <p className="text-gray-400 mb-8">
        Undercollateralized lending powered by your reputation
      </p>
      <ConnectButton />
    </div>
  );

  if (loading) return <div>Loading your credit profile...</div>;

  // New user — no SBT yet
  if (!profile?.exists) return <OnboardingFlow address={address} />;

  // Existing user
  return (
    <div className="grid grid-cols-2 gap-6 p-8">
      <ScoreDashboard profile={profile} />
      <LoanPanel address={address} profile={profile} />
    </div>
  );
}


Onboarding Flow Component
// frontend/components/OnboardingFlow.tsx
'use client';
import { useState } from 'react';
import { runFhenixAttestation } from '@/lib/fhenix';

export default function OnboardingFlow({ address }: { address: string }) {
  const [step, setStep] = useState<'idle' | 'gmx' | 'fhenix' | 'scoring' | 'done'>('idle');
  const [gmxData, setGmxData] = useState(null);
  const [fhenixAttestation, setFhenixAttestation] = useState(null);
  const [scoreResult, setScoreResult] = useState(null);

  const startOnboarding = async () => {
    // Step 1: Auto-fetch GMX (no user action)
    setStep('gmx');
    const gmx = await fetch(`/api/gmx/${address}`).then(r => r.json());
    setGmxData(gmx);

    // Step 2: Fhenix attestation (user connects bank/CEX)
    setStep('fhenix');
  };

  const completeFhenix = async (source: 'bank' | 'cex') => {
    // In production: OAuth flow opens here
    const attestation = await runFhenixAttestation(source, {
      accessToken: 'from-oauth-flow',
      accountId: 'user-account-id'
    });
    setFhenixAttestation(attestation);

    // Step 3: Score
    setStep('scoring');
    const result = await fetch('/api/score', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: address, fhenix_attestation: attestation })
    }).then(r => r.json());

    setScoreResult(result);
    setStep('done');
  };

  return (
    <div className="max-w-lg mx-auto p-8">
      <h2 className="text-2xl font-bold mb-4">Build Your Credit Profile</h2>

      {step === 'idle' && (
        <button onClick={startOnboarding}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg w-full">
          Get Started
        </button>
      )}

      {step === 'gmx' && (
        <div className="animate-pulse">
          Reading your GMX trading history automatically...
        </div>
      )}

      {step === 'fhenix' && (
        <div>
          <p className="mb-4 text-gray-400">
            Verify your financial standing. Your data never leaves your device.
          </p>
          <button onClick={() => completeFhenix('bank')}
            className="bg-green-600 text-white px-6 py-3 rounded-lg w-full mb-3">
            Connect Bank Account (Recommended)
          </button>
          <button onClick={() => completeFhenix('cex')}
            className="border border-gray-600 text-white px-6 py-3 rounded-lg w-full">
            Connect CEX Account
          </button>
        </div>
      )}

      {step === 'scoring' && (
        <div className="animate-pulse">
          Computing your CredScore...
        </div>
      )}

      {step === 'done' && scoreResult && (
        <div className="text-center">
          <div className="text-6xl font-black text-blue-400 mb-4">
            {scoreResult.cred_score}
          </div>
          <p>Your CredScore has been minted to your wallet.</p>
        </div>
      )}
    </div>
  );
}


PHASE 6 — LayerZero Spoke Deployment
Deploy these contracts on Arbitrum Sepolia and Base Sepolia.
// scripts/deploy-spoke.js
async function deploySpoke(chainName) {
    const [deployer] = await ethers.getSigners();

    // On spoke chains, we only need the OApp receiver
    const OApp = await ethers.getContractFactory("CredFlowOApp");
    const oapp = await OApp.deploy(
        process.env[`LAYERZERO_ENDPOINT_${chainName.toUpperCase()}`],
        ethers.ZeroAddress,  // No SBT on spoke chains
        deployer.address
    );
    await oapp.waitForDeployment();

    console.log(`${chainName} OApp:`, await oapp.getAddress());

    // Wire hub → spoke peer
    // This tells the hub OApp to trust messages from/to this spoke
    console.log("Now call setPeer() on hub OApp with this address");
}

After deploying spokes, set peers on the hub:
// scripts/set-peers.js
async function setPeers() {
    const oapp = await ethers.getContractAt("CredFlowOApp", HUB_OAPP_ADDRESS);

    await oapp.setPeer(
        ARBITRUM_CHAIN_ID,
        ethers.zeroPadValue(ARBITRUM_OAPP_ADDRESS, 32)
    );
    await oapp.setPeer(
        BASE_CHAIN_ID,
        ethers.zeroPadValue(BASE_OAPP_ADDRESS, 32)
    );
}


PHASE 7 — OpenZeppelin Defender Automation
Set up three automated jobs in OZ Defender.
Job 1 — Cross-Chain Sync (every 4 hours)
In OZ Defender dashboard: create an Autotask. Paste this:
const { DefenderRelayProvider } = require('defender-relay-client/lib/ethers');

exports.handler = async function(credentials) {
    const provider = new DefenderRelayProvider(credentials);
    const signer = provider.getSigner();

    // Call Cross-Chain Sync Agent API
    const response = await fetch('YOUR_AGENT_API/sync', { method: 'POST' });
    const result = await response.json();
    console.log("Sync result:", result);
};

Job 2 — Portfolio Health Check (every 12 blocks)
exports.handler = async function(credentials) {
    const response = await fetch('YOUR_AGENT_API/monitor', { method: 'POST' });
    console.log("Monitor sweep complete");
};

Job 3 — Rate Optimization (every hour)
exports.handler = async function(credentials) {
    const response = await fetch('YOUR_AGENT_API/optimize-rates', { method: 'POST' });
    console.log("Rate optimization complete");
};


PHASE 8 — Testing
Test every component in isolation before integration testing.
// tests/CredScoreSBT.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CredScoreSBT", function () {
    let sbt, owner, scorer, user;

    beforeEach(async () => {
        [owner, scorer, user] = await ethers.getSigners();
        const SBT = await ethers.getContractFactory("CredScoreSBT");
        sbt = await SBT.deploy(owner.address);
        await sbt.grantRole(await sbt.SCORER_ROLE(), scorer.address);
    });

    it("Mints SBT with correct score", async () => {
        await sbt.connect(scorer).mintSBT(
            user.address, 650, 71, 68, 60, "ipfs://test"
        );
        const profile = await sbt.getProfile(user.address);
        expect(profile.score).to.equal(650);
        expect(profile.exists).to.be.true;
    });

    it("Blocks SBT transfer", async () => {
        await sbt.connect(scorer).mintSBT(
            user.address, 650, 71, 68, 60, "ipfs://test"
        );
        // Attempt transfer should revert
        await expect(
            sbt.connect(user).transferFrom(user.address, scorer.address, 0)
        ).to.be.revertedWith("SBT: non-transferable");
    });

    it("Records default and drops score", async () => {
        await sbt.connect(scorer).mintSBT(
            user.address, 650, 71, 68, 60, "ipfs://test"
        );
        const agentRole = await sbt.AGENT_ROLE();
        await sbt.grantRole(agentRole, scorer.address);
        await sbt.connect(scorer).recordDefault(user.address);
        const profile = await sbt.getProfile(user.address);
        expect(profile.defaultCount).to.equal(1);
    });
});

# tests/test_scoring.py
import pytest
from ml.train_model import score_wallet

def test_high_score_wallet():
    features = {
        "wallet_age_days": 730,
        "tx_count": 450,
        "protocol_diversity": 8,
        "total_borrows": 5,
        "repayment_rate": 1.0,
        "defi_liquidation_count": 0,
        "avg_loan_duration_days": 25,
        "eth_balance": 3.5,
        "gmx_sub_score": 85,
        "gmx_liquidation_count": 0,
        "gmx_avg_leverage": 3.2,
        "gmx_total_positions": 40,
        "has_gmx_history": 1,
        "fhenix_income_verified": 1,
        "fhenix_balance_verified": 1,
        "fhenix_repayment_clean": 1,
        "fhenix_account_age_years": 4,
    }
    result = score_wallet(features)
    assert result["cred_score"] >= 700, "High quality wallet should score 700+"

def test_new_user_with_attestation():
    features = {
        "wallet_age_days": 1,
        "tx_count": 2,
        "protocol_diversity": 0,
        "total_borrows": 0,
        "repayment_rate": 0.5,
        "defi_liquidation_count": 0,
        "avg_loan_duration_days": 0,
        "eth_balance": 0.1,
        "gmx_sub_score": 50,
        "gmx_liquidation_count": 0,
        "gmx_avg_leverage": 0,
        "gmx_total_positions": 0,
        "has_gmx_history": 0,
        "fhenix_income_verified": 1,
        "fhenix_balance_verified": 1,
        "fhenix_repayment_clean": 1,
        "fhenix_account_age_years": 3,
    }
    result = score_wallet(features)
    assert result["cred_score"] >= 550, "New user with clean attestation should get access"


Build Order Summary
Follow this exact sequence. Do not start a phase before the previous is tested and working.
Phase 0 — Environment, wallets, API keys, dependencies
Phase 1 — Smart contracts. Deploy CredScoreSBT first, then CredFlowLending, then OApp, then LiquidityPool. Run contract tests before moving on.
Phase 2 — ML pipeline. Fetch training data from Dune, build feature vectors, train XGBoost, validate AUC, spin up scoring FastAPI. Confirm the API returns sensible scores for test wallets.
Phase 3 — Agents. Build Underwriter Agent first as it ties ML to contracts. Then Portfolio Monitor, then Liquidation, then Cross-Chain Sync, then Rate Optimizer. Test each agent independently with mock data before connecting to live contracts.
Phase 4 — Fhenix integration. Build the browser-side FHE flow, test with a mock attestation, confirm the proof hash posts on-chain correctly.
Phase 5 — Frontend. Build wallet connection and onboarding flow first. Then score dashboard. Then loan request panel. Then repayment UI.
Phase 6 — Spoke deployment on Arbitrum Sepolia and Base Sepolia. Set peers. Test a full cross-chain score broadcast end to end.
Phase 7 — OZ Defender. Set up all three autotask jobs. Confirm they call the agent APIs correctly.
Phase 8 — Full integration test. Run the complete Maya scenario from wallet connect to repayment, then again through to default and cross-chain propagation. Fix everything that breaks.

