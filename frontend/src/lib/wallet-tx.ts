import type { Hash, PublicClient, WalletClient, WriteContractParameters } from "viem";

const chainLocks = new Map<number, Promise<unknown>>();

function withChainLock<T>(chainId: number, fn: () => Promise<T>): Promise<T> {
  const prev = chainLocks.get(chainId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chainLocks.set(
    chainId,
    next.catch(() => undefined)
  );
  return next;
}

function isRetryableTxError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("nonce too low") ||
    msg.includes("nonce too high") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known")
  );
}

/** Serialized wallet writes with pending nonce + gas bump (avoids spoke borrow races). */
export async function sendWalletContractWrite(
  publicClient: PublicClient,
  walletClient: WalletClient,
  params: WriteContractParameters,
  options?: { retries?: number }
): Promise<Hash> {
  const account = params.account;
  if (!account || typeof account === "string") {
    throw new Error("sendWalletContractWrite requires an account");
  }
  const address = typeof account === "object" ? account.address : account;
  const chainId = publicClient.chain?.id;
  if (!chainId) throw new Error("Chain id missing on public client");

  const retries = options?.retries ?? 5;

  return withChainLock(chainId, async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const nonce = await publicClient.getTransactionCount({
          address,
          blockTag: "pending",
        });
        const fees = await publicClient.estimateFeesPerGas().catch(() => null);
        const bumpPct = 100n + BigInt(attempt) * 15n;

        const hash = await walletClient.writeContract({
          ...params,
          nonce,
          ...(fees
            ? {
                maxFeePerGas: (fees.maxFeePerGas * bumpPct) / 100n,
                maxPriorityFeePerGas: (fees.maxPriorityFeePerGas * bumpPct) / 100n,
              }
            : {}),
        } as WriteContractParameters);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(`Transaction reverted: ${hash}`);
        }
        return hash;
      } catch (err) {
        lastErr = err;
        if (isRetryableTxError(err) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Transaction failed");
  });
}
