require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_ROBINHOOD = process.env.RPC_ROBINHOOD || "https://rpc.testnet.chain.robinhood.com";

const hardhatAccounts = [
  { privateKey: DEPLOYER_PRIVATE_KEY, balance: "1000000000000000000" },
  { privateKey: "0x59c6995e998f97a5a0044966f0945389fc9c88daf8c7d773e06ce3bb366a5d14", balance: "10000000000000000000" },
  { privateKey: "0x5de4111afa1a4b94908f83303e857cd1ed5679d927c3e06143da216f594565bd", balance: "10000000000000000000" },
];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 46630,
      accounts: hardhatAccounts,
      forking: process.env.HARDHAT_FORK !== "false"
        ? { url: RPC_ROBINHOOD, blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined }
        : undefined,
    },
    robinhoodTestnet: {
      url: RPC_ROBINHOOD,
      chainId: 46630,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    arbitrumSepolia: {
      url: process.env.RPC_ARBITRUM_SEPOLIA || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url:
        process.env.ALCHEMY_BASE_SEPOLIA_RPC ||
        process.env.RPC_BASE_SEPOLIA ||
        "https://sepolia.base.org",
      chainId: 84532,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
