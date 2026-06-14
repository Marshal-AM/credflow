import { createPublicClient, decodeEventLog, http, parseAbiItem } from "viem";
import hubAddresses from "@/lib/addresses.json";
import { robinhoodTestnet } from "@/lib/chains";

const SBT_MINTED = parseAbiItem(
  "event SBTMinted(address indexed wallet, uint16 initialScore)"
);

const ERC721_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

export const HUB_SBT_CONTRACT = hubAddresses.sbt as `0x${string}`;

const HAS_PROFILE_ABI = [
  {
    name: "hasProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

function hubRpc(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_ROBINHOOD ||
    process.env.RPC_ROBINHOOD ||
    "https://rpc.testnet.chain.robinhood.com"
  );
}

/** Whether hub CredScoreSBT already has a profile for this wallet. */
export async function hubHasSbtProfile(wallet: `0x${string}`): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: robinhoodTestnet,
      transport: http(hubRpc()),
    });
    return await client.readContract({
      address: HUB_SBT_CONTRACT,
      abi: HAS_PROFILE_ABI,
      functionName: "hasProfile",
      args: [wallet],
    });
  } catch {
    return false;
  }
}

/** First SBTMinted tx for wallet on Robinhood hub (if any). */
export async function fetchSbtMintTxHash(
  wallet: `0x${string}`
): Promise<string | null> {
  try {
    const client = createPublicClient({
      chain: robinhoodTestnet,
      transport: http(hubRpc()),
    });
    const logs = await client.getLogs({
      address: HUB_SBT_CONTRACT,
      event: SBT_MINTED,
      args: { wallet },
      fromBlock: 0n,
      toBlock: "latest",
    });
    if (!logs.length) return null;
    return logs[logs.length - 1].transactionHash;
  } catch {
    return null;
  }
}

/** ERC-721 token id minted to wallet on hub SBT (from Transfer from zero address). */
export async function fetchSbtTokenId(
  wallet: `0x${string}`,
  mintTxHash?: string | null
): Promise<string | null> {
  try {
    const client = createPublicClient({
      chain: robinhoodTestnet,
      transport: http(hubRpc()),
    });

    if (mintTxHash) {
      const receipt = await client.getTransactionReceipt({
        hash: mintTxHash as `0x${string}`,
      });
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== HUB_SBT_CONTRACT.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: [ERC721_TRANSFER],
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === "Transfer" &&
            decoded.args.from === "0x0000000000000000000000000000000000000000" &&
            decoded.args.to?.toLowerCase() === wallet.toLowerCase()
          ) {
            return String(decoded.args.tokenId);
          }
        } catch {
          /* not a Transfer log */
        }
      }
    }

    const logs = await client.getLogs({
      address: HUB_SBT_CONTRACT,
      event: ERC721_TRANSFER,
      args: {
        from: "0x0000000000000000000000000000000000000000",
        to: wallet,
      },
      fromBlock: 0n,
      toBlock: "latest",
    });
    if (!logs.length) return null;
    const tokenId = logs[logs.length - 1].args.tokenId;
    return tokenId != null ? String(tokenId) : null;
  } catch {
    return null;
  }
}
