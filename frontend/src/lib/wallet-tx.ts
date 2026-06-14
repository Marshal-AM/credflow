import type { Hash, PublicClient, WalletClient, WriteContractParameters } from "viem";
import type { useSendTransaction, useWriteContract } from "wagmi";

const chainLocks = new Map<number, Promise<unknown>>();

type WriteContractAsync = ReturnType<typeof useWriteContract>["writeContractAsync"];
type SendTransactionAsync = ReturnType<typeof useSendTransaction>["sendTransactionAsync"];

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
    msg.includes("already known") ||
    msg.includes("max fee per gas less than block base fee") ||
    msg.includes("fee cap less than block base fee") ||
    msg.includes("transaction underpriced")
  );
}

export type ContractGasFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/** Fresh EIP-1559 fees with buffer so maxFeePerGas stays above pending base fee. */
export async function buildContractGasFees(
  publicClient: PublicClient,
  options?: { bufferPct?: number; attempt?: number }
): Promise<ContractGasFees | null> {
  try {
    const bufferPct = BigInt(options?.bufferPct ?? 130);
    const attemptBump = 100n + BigInt(options?.attempt ?? 0) * 20n;
    const mult = (bufferPct * attemptBump) / 100n;

    const [fees, block] = await Promise.all([
      publicClient.estimateFeesPerGas(),
      publicClient.getBlock({ blockTag: "pending" }).catch(() => publicClient.getBlock()),
    ]);

    const baseFee = block.baseFeePerGas ?? 0n;
    let maxPriorityFeePerGas = ((fees.maxPriorityFeePerGas ?? 1n) * mult) / 100n;
    if (maxPriorityFeePerGas < 1n) maxPriorityFeePerGas = 1n;

    let maxFeePerGas = ((fees.maxFeePerGas ?? baseFee) * mult) / 100n;

    // Must exceed base fee; add priority + 25% base headroom for block-to-block drift.
    const floor = baseFee + maxPriorityFeePerGas + baseFee / 4n;
    if (maxFeePerGas < floor) maxFeePerGas = floor;

    // Common safe minimum: 2× base + priority (covers rapid base fee spikes on L2).
    if (baseFee > 0n) {
      const safeMin = baseFee * 2n + maxPriorityFeePerGas;
      if (maxFeePerGas < safeMin) maxFeePerGas = safeMin;
    }

    return { maxFeePerGas, maxPriorityFeePerGas };
  } catch {
    return null;
  }
}

type WalletWriteParams = Parameters<WriteContractAsync>[0];

/** writeContract with live fee estimation — avoids stale MetaMask maxFeePerGas on L2. */
export async function writeContractWithGas(
  publicClient: PublicClient,
  writeContractAsync: WriteContractAsync,
  params: WalletWriteParams,
  options?: { retries?: number }
): Promise<Hash> {
  const retries = options?.retries ?? 4;
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const gas = await buildContractGasFees(publicClient, { attempt });
      return await writeContractAsync({
        ...params,
        ...(gas
          ? {
              maxFeePerGas: gas.maxFeePerGas,
              maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
            }
          : {}),
      } as WalletWriteParams);
    } catch (err) {
      lastErr = err;
      if (isRetryableTxError(err) && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Transaction failed");
}

type SendTransactionParams = Parameters<SendTransactionAsync>[0];

/** sendTransaction with live fee estimation — same EIP-1559 fix as writeContractWithGas. */
export async function sendTransactionWithGas(
  publicClient: PublicClient,
  sendTransactionAsync: SendTransactionAsync,
  params: SendTransactionParams,
  options?: { retries?: number }
): Promise<Hash> {
  const retries = options?.retries ?? 4;
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const gas = await buildContractGasFees(publicClient, { attempt });
      return await sendTransactionAsync({
        ...params,
        ...(gas
          ? {
              maxFeePerGas: gas.maxFeePerGas,
              maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
            }
          : {}),
      } as SendTransactionParams);
    } catch (err) {
      lastErr = err;
      if (isRetryableTxError(err) && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Transaction failed");
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
        const gas = await buildContractGasFees(publicClient, { attempt });

        const hash = await walletClient.writeContract({
          ...params,
          nonce,
          ...(gas
            ? {
                maxFeePerGas: gas.maxFeePerGas,
                maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
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
