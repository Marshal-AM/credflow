import { createPublicClient, http, parseAbiItem } from "viem";
import hubAddresses from "@/lib/addresses.json";
import { robinhoodTestnet } from "@/lib/chains";

const SBT_MINTED = parseAbiItem(
  "event SBTMinted(address indexed wallet, uint16 initialScore)"
);

function hubRpc(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_ROBINHOOD ||
    process.env.RPC_ROBINHOOD ||
    "https://rpc.testnet.chain.robinhood.com"
  );
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
      address: hubAddresses.sbt as `0x${string}`,
      event: SBT_MINTED,
      args: { wallet },
      fromBlock: 0n,
      toBlock: "latest",
    });
    if (!logs.length) return null;
    return logs[0].transactionHash;
  } catch {
    return null;
  }
}
