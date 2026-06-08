// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CredFlowLP is ERC20, ReentrancyGuard, Ownable {
    IERC20 public borrowToken;
    address public lendingContract;

    uint256 public totalDeposited;
    uint256 public totalBorrowed;

    event Deposited(address indexed lender, uint256 amount, uint256 lpMinted);
    event Withdrawn(address indexed lender, uint256 lpBurned, uint256 usdgReturned);

    constructor(address _borrowToken) ERC20("CredFlow LP", "cfUSDG") {
        borrowToken = IERC20(_borrowToken);
    }

    function setLendingContract(address _lending) external onlyOwner {
        lendingContract = _lending;
    }

    function recordBorrow(uint256 amount) external {
        require(msg.sender == lendingContract, "Not lending contract");
        totalBorrowed += amount;
    }

    function recordRepayment(uint256 amount) external {
        require(msg.sender == lendingContract, "Not lending contract");
        totalBorrowed = totalBorrowed > amount ? totalBorrowed - amount : 0;
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        uint256 lpToMint = totalSupply() == 0
            ? amount
            : (amount * totalSupply()) / totalDeposited;

        borrowToken.transferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        _mint(msg.sender, lpToMint);

        emit Deposited(msg.sender, amount, lpToMint);
    }

    function withdraw(uint256 lpAmount) external nonReentrant {
        require(lpAmount <= balanceOf(msg.sender), "Insufficient LP");
        uint256 tokenAmount = (lpAmount * totalDeposited) / totalSupply();
        require(tokenAmount <= availableLiquidity(), "Insufficient liquidity");

        _burn(msg.sender, lpAmount);
        totalDeposited -= tokenAmount;
        borrowToken.transfer(msg.sender, tokenAmount);

        emit Withdrawn(msg.sender, lpAmount, tokenAmount);
    }

    function availableLiquidity() public view returns (uint256) {
        return borrowToken.balanceOf(address(this));
    }

    function utilizationRate() public view returns (uint256) {
        if (totalDeposited == 0) return 0;
        return (totalBorrowed * 10000) / totalDeposited;
    }
}
