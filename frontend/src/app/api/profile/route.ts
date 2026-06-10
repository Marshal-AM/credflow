import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { getFrontendAddress } from "@/lib/wallet-server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import hubAddresses from "@/lib/addresses.json";
import { robinhoodTestnet } from "@/lib/chains";

const SBT_ABI = [
  {
    name: "hasProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "score", type: "uint16" },
          { name: "borrowSubScore", type: "uint16" },
          { name: "walletSubScore", type: "uint16" },
          { name: "loanStatus", type: "uint8" },
          { name: "totalLoans", type: "uint8" },
          { name: "defaultCount", type: "uint8" },
          { name: "lastUpdated", type: "uint32" },
          { name: "exists", type: "bool" },
          { name: "loanActive", type: "bool" },
          { name: "shapeExplanationCID", type: "string" },
        ],
      },
    ],
  },
] as const;

export async function GET() {
  try {
    const wallet = getFrontendAddress();
    const supabase = getSupabaseAdmin();
    let profile: Record<string, unknown> | null = null;

    if (supabase) {
      const { data } = await supabase
        .from("account_profiles")
        .select("*")
        .eq("wallet_address", wallet.toLowerCase())
        .maybeSingle();
      profile = data;
    }

    const rpc =
      process.env.NEXT_PUBLIC_RPC_ROBINHOOD ||
      process.env.RPC_ROBINHOOD ||
      "https://rpc.testnet.chain.robinhood.com";
    const client = createPublicClient({
      chain: robinhoodTestnet,
      transport: http(rpc),
    });

    let hasOnChainSbt = false;
    let onChainScore: number | null = null;
    try {
      hasOnChainSbt = await client.readContract({
        address: hubAddresses.sbt as `0x${string}`,
        abi: SBT_ABI,
        functionName: "hasProfile",
        args: [wallet],
      });
      if (hasOnChainSbt) {
        const p = await client.readContract({
          address: hubAddresses.sbt as `0x${string}`,
          abi: SBT_ABI,
          functionName: "getProfile",
          args: [wallet],
        });
        onChainScore = Number(p.score);
      }
    } catch {
      /* RPC optional */
    }

    return NextResponse.json({
      wallet,
      profile,
      hasOnChainSbt,
      onChainScore,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Profile load failed" },
      { status: 500 }
    );
  }
}
