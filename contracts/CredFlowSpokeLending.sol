// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ICredFlowCreditRegistry.sol";
import "./interfaces/ILTVOracle.sol";
import "./interfaces/ILiquidityPool.sol";

/// @title CredFlowSpokeLending — borrow on spoke chains using LZ-propagated credit scores.
contract CredFlowSpokeLending is ReentrancyGuard, Pausable, AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    ICredFlowCreditRegistry public creditRegistry;
    ILTVOracle public priceOracle;
    ILiquidityPool public liquidityPool;
    IERC20 public borrowToken;

    uint16[6] public scoreTiers = [500, 580, 620, 680, 720, 750];
    uint16[6] public ltvTiers = [4000, 5000, 6000, 6500, 7500, 8500];
    uint16[6] public ratePremiums = [700, 500, 400, 300, 200, 100];

    uint256 public baseRate = 500;
    uint256 public liquidationThreshold = 8500;
    uint256 public liquidationPenalty = 500;

    struct Loan {
        address borrower;
        address collateralToken;
        uint256 collateralAmount;
        uint256 borrowedAmount;
        uint256 interestRate;
        uint256 startTime;
        uint256 dueTime;
        uint256 maxLTV;
        bool active;
    }

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public activeLoanId;
    uint256 public loanCounter;

    event LoanCreated(uint256 indexed loanId, address borrower, uint256 amount, uint256 ltv);
    event LoanRepaid(uint256 indexed loanId, address borrower, uint256 totalRepaid);
    event LoanLiquidated(uint256 indexed loanId, address borrower, uint256 recovered);
    event HealthWarning(uint256 indexed loanId, address borrower, uint256 currentLTV);

    constructor(address _creditRegistry, address _oracle, address _borrowToken, address admin) {
        creditRegistry = ICredFlowCreditRegistry(_creditRegistry);
        priceOracle = ILTVOracle(_oracle);
        borrowToken = IERC20(_borrowToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setLiquidityPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        liquidityPool = ILiquidityPool(_pool);
    }

    function setLiquidationParams(uint256 _threshold, uint256 _penalty)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        liquidationThreshold = _threshold;
        liquidationPenalty = _penalty;
    }

    function setBaseRate(uint256 _rate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseRate = _rate;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function requestLoan(
        uint256 borrowAmount,
        address collateralToken,
        uint256 collateralAmount,
        uint256 durationDays
    ) external nonReentrant whenNotPaused {
        uint16 score = creditRegistry.getScore(msg.sender);
        require(score > 0, "No LZ credit score");
        require(!creditRegistry.isBlacklisted(msg.sender), "Wallet blacklisted");
        require(!creditRegistry.isLoanActive(msg.sender), "Cross-chain loan active");
        require(activeLoanId[msg.sender] == 0, "Existing loan active");

        uint16 maxLTV = getLTVForScore(score);
        require(maxLTV > 0, "Score too low");
        uint256 interestRate = getRateForScore(score);

        uint256 collateralValueUSD = priceOracle.getValueUSD(collateralToken, collateralAmount);
        uint256 maxBorrow = (collateralValueUSD * maxLTV) / 10000;
        require(borrowAmount <= maxBorrow, "Exceeds max LTV");
        require(borrowToken.balanceOf(address(this)) >= borrowAmount, "Insufficient pool");

        IERC20(collateralToken).transferFrom(msg.sender, address(this), collateralAmount);

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

        if (address(liquidityPool) != address(0)) {
            liquidityPool.recordBorrow(borrowAmount);
        }

        borrowToken.transfer(msg.sender, borrowAmount);
        emit LoanCreated(loanCounter, msg.sender, borrowAmount, maxLTV);
    }

    function repayLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.borrower == msg.sender, "Not borrower");
        require(loan.active, "Loan not active");

        uint256 interest = calculateInterest(loan);
        uint256 totalRepay = loan.borrowedAmount + interest;

        borrowToken.transferFrom(msg.sender, address(this), totalRepay);
        IERC20(loan.collateralToken).transfer(msg.sender, loan.collateralAmount);

        loan.active = false;
        activeLoanId[msg.sender] = 0;

        if (address(liquidityPool) != address(0)) {
            liquidityPool.recordRepayment(loan.borrowedAmount);
        }

        emit LoanRepaid(loanId, msg.sender, totalRepay);
    }

    function liquidate(uint256 loanId) external onlyRole(AGENT_ROLE) nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Not active");

        uint256 currentLTV = getCurrentLTV(loanId);
        require(currentLTV >= liquidationThreshold, "Not liquidatable");

        uint256 collateralValue = priceOracle.getValueUSD(
            loan.collateralToken,
            loan.collateralAmount
        );
        uint256 interest = calculateInterest(loan);
        uint256 totalOwed = loan.borrowedAmount + interest;
        uint256 penalty = (totalOwed * liquidationPenalty) / 10000;
        uint256 totalToRecover = totalOwed + penalty;

        uint256 recovered = collateralValue >= totalToRecover ? totalToRecover : collateralValue;

        loan.active = false;
        activeLoanId[loan.borrower] = 0;

        if (address(liquidityPool) != address(0)) {
            liquidityPool.recordRepayment(loan.borrowedAmount);
        }

        emit LoanLiquidated(loanId, loan.borrower, recovered);
    }

    function emitHealthWarning(uint256 loanId) external onlyRole(AGENT_ROLE) {
        uint256 currentLTV = getCurrentLTV(loanId);
        emit HealthWarning(loanId, loans[loanId].borrower, currentLTV);
    }

    function getCurrentLTV(uint256 loanId) public view returns (uint256) {
        Loan memory loan = loans[loanId];
        uint256 collateralValue = priceOracle.getValueUSD(
            loan.collateralToken,
            loan.collateralAmount
        );
        require(collateralValue > 0, "Zero collateral value");
        uint256 interest = calculateInterest(loan);
        return ((loan.borrowedAmount + interest) * 10000) / collateralValue;
    }

    function calculateInterest(Loan memory loan) public view returns (uint256) {
        uint256 elapsed = block.timestamp - loan.startTime;
        return (loan.borrowedAmount * loan.interestRate * elapsed) / (10000 * 365 days);
    }

    function getLTVForScore(uint16 score) public view returns (uint16) {
        for (uint256 i = scoreTiers.length; i > 0; i--) {
            if (score >= scoreTiers[i - 1]) return ltvTiers[i - 1];
        }
        return 0;
    }

    function getRateForScore(uint16 score) public view returns (uint256) {
        for (uint256 i = scoreTiers.length; i > 0; i--) {
            if (score >= scoreTiers[i - 1]) {
                return baseRate + ratePremiums[i - 1];
            }
        }
        return baseRate + 1000;
    }
}
