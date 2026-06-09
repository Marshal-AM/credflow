const { Web3 } = require("web3");

const NETWORKS = {
  arbitrum: {
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    feedAddress: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
    explorerUrl: "https://arbiscan.io/address/0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
  },
  base: {
    name: "Base Mainnet",
    rpcUrl: "https://mainnet.base.org",
    feedAddress: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    explorerUrl: "https://basescan.org/address/0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  },
};

const ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "description",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

async function fetchPrice(key) {
  const network = NETWORKS[key];
  if (!network) {
    throw new Error(`Unknown network "${key}". Choose: ${Object.keys(NETWORKS).join(", ")}`);
  }

  const web3 = new Web3(network.rpcUrl);
  const feed = new web3.eth.Contract(ABI, network.feedAddress);

  const [decimals, description, roundData] = await Promise.all([
    feed.methods.decimals().call(),
    feed.methods.description().call(),
    feed.methods.latestRoundData().call(),
  ]);

  const price = Number(roundData.answer) / 10 ** Number(decimals);
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - Number(roundData.updatedAt);

  return {
    key,
    network: network.name,
    feed: description,
    address: network.feedAddress,
    explorerUrl: network.explorerUrl,
    price,
    answer: roundData.answer,
    decimals: Number(decimals),
    roundId: roundData.roundId.toString(),
    updatedAt: new Date(Number(roundData.updatedAt) * 1000).toISOString(),
    ageSeconds,
    isStale: ageSeconds > 3600,
  };
}

module.exports = { NETWORKS, fetchPrice, ABI };
