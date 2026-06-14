import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { requireRequestWallet } from "@/lib/wallet-request";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveLatestSbtMintCredentials } from "@/lib/sbt-mint-credentials";
import { fetchSbtTokenId } from "@/lib/sbt-chain";
import { patchScoreSnapshot } from "@/lib/score-display";
import hubAddresses from "@/lib/addresses.json";
import { hubNftExplorerUrl, robinhoodTestnet } from "@/lib/chains";

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

export async function GET(req: NextRequest) {
  try {
    const wallet = requireRequestWallet(req);
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

    if (hasOnChainSbt && onChainScore != null && profile) {
      const staleCred =
        profile.cred_score == null || Number(profile.cred_score) !== onChainScore;
      const staleMl =
        profile.ml_cred_score == null || Number(profile.ml_cred_score) < onChainScore;
      const staleFormula =
        profile.on_chain_cred_score == null ||
        Number(profile.on_chain_cred_score) < onChainScore;
      const patchedSnapshot = patchScoreSnapshot(profile.score_snapshot, onChainScore);

      if (staleCred || staleMl || staleFormula || patchedSnapshot) {
        const merged = {
          ...profile,
          cred_score: onChainScore,
          on_chain_cred_score: onChainScore,
          sbt_score_on_chain: onChainScore,
          ...(staleMl ? { ml_cred_score: onChainScore } : {}),
          ...(patchedSnapshot ? { score_snapshot: patchedSnapshot } : {}),
        };

        if (supabase) {
          const { data: synced } = await supabase
            .from("account_profiles")
            .update({
              cred_score: onChainScore,
              on_chain_cred_score: onChainScore,
              sbt_score_on_chain: onChainScore,
              ...(staleMl ? { ml_cred_score: onChainScore } : {}),
              ...(patchedSnapshot ? { score_snapshot: patchedSnapshot } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("wallet_address", wallet.toLowerCase())
            .select()
            .maybeSingle();
          profile = (synced as Record<string, unknown> | null) ?? merged;
        } else {
          profile = merged;
        }
      }
    }

    let latestScoreRun: Record<string, unknown> | null = null;
    if (supabase) {
      const { data: run } = await supabase
        .from("score_runs")
        .select("id, status, require_reclaim, reclaim_session_id, response, error_message, created_at")
        .eq("wallet_address", wallet.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      latestScoreRun = run as Record<string, unknown> | null;
    }

    let mintTxHash: string | null = null;
    let sbtTokenId: string | null = null;
    if (hasOnChainSbt) {
      if (supabase) {
        const mintCreds = await resolveLatestSbtMintCredentials(wallet, supabase, {
          latestScoreRunCreatedAt: latestScoreRun?.created_at as string | undefined,
          profileMintTxHash: profile?.mint_tx_hash as string | undefined,
          profileMintedAt: profile?.minted_at as string | undefined,
        });
        mintTxHash = mintCreds.mintTxHash;
        sbtTokenId = mintCreds.sbtTokenId;
      }
      if (!sbtTokenId) {
        sbtTokenId = await fetchSbtTokenId(wallet as `0x${string}`, mintTxHash);
      }
    }

    const sbtLink =
      sbtTokenId && hubAddresses.sbt
        ? hubNftExplorerUrl(hubAddresses.sbt, sbtTokenId)
        : null;

    return NextResponse.json({
      wallet,
      profile,
      hasOnChainSbt,
      onChainScore,
      mintTxHash,
      sbtTokenId,
      sbtLink,
      latestScoreRun,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Profile load failed" },
      { status: 500 }
    );
  }
}
