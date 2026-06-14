import type { Hash } from "viem";
import { getPublicClient } from "@/lib/loan-server";
import type { ChainKey } from "@/lib/chains";

const LOAN_TRIGGER_SOURCES = new Set(["loan_created", "loan_repaid"]);
const LOAN_CHAINS: ChainKey[] = ["hub", "arbitrum", "base"];

function isLoanTriggerSource(source: string): boolean {
  return (
    LOAN_TRIGGER_SOURCES.has(source) || source.startsWith("loan_created_")
  );
}

function chainFromTriggerSource(source: string): ChainKey | null {
  if (source === "loan_created" || source === "loan_repaid") return "hub";
  if (source.startsWith("loan_created_")) {
    return parseChainKey(source.slice("loan_created_".length));
  }
  return null;
}

function parseChainKey(value: unknown): ChainKey | null {
  if (value === "hub" || value === "arbitrum" || value === "base") {
    return value;
  }
  return null;
}

export type LzBroadcastRow = {
  id: string;
  related_onchain_tx: string | null;
  trigger_source: string;
  message_type: string;
  status?: string;
  [key: string]: unknown;
};

export async function isChainTxSuccessful(
  chainKey: ChainKey,
  txHash: string
): Promise<boolean> {
  try {
    const client = getPublicClient(chainKey);
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hash,
    });
    return receipt.status === "success";
  } catch {
    return false;
  }
}

/** @deprecated Prefer isChainTxSuccessful or isLoanTxSuccessful */
export async function isHubTxSuccessful(txHash: string): Promise<boolean> {
  return isChainTxSuccessful("hub", txHash);
}

/** Borrow/repay txs may live on hub or any spoke. */
export async function isLoanTxSuccessful(
  txHash: string,
  chainKeyHint?: ChainKey | null
): Promise<boolean> {
  if (chainKeyHint) {
    return isChainTxSuccessful(chainKeyHint, txHash);
  }
  const checks = await Promise.all(
    LOAN_CHAINS.map((chainKey) => isChainTxSuccessful(chainKey, txHash))
  );
  return checks.some(Boolean);
}

/** Drop LZ rows whose related hub borrow/repay tx reverted (stale bad syncs). */
export async function filterValidLzBroadcasts<T extends LzBroadcastRow>(
  rows: T[]
): Promise<{ visible: T[]; hiddenCount: number }> {
  const cache = new Map<string, boolean>();
  const visible: T[] = [];
  let hiddenCount = 0;

  async function triggerOk(tx: string, source: string): Promise<boolean> {
    const key = `${source}:${tx.toLowerCase()}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        await isLoanTxSuccessful(tx, chainFromTriggerSource(source))
      );
    }
    return cache.get(key)!;
  }

  for (const row of rows) {
    const tx = row.related_onchain_tx;
    if (!tx || !isLoanTriggerSource(row.trigger_source)) {
      visible.push(row);
      continue;
    }
    if (await triggerOk(tx, row.trigger_source)) {
      visible.push(row);
    } else {
      hiddenCount += 1;
    }
  }

  return { visible, hiddenCount };
}

export async function filterValidLoanEvents<
  T extends { tx_hash: string; event_type: string; chain_key?: string },
>(rows: T[]): Promise<T[]> {
  const cache = new Map<string, boolean>();
  const out: T[] = [];

  for (const row of rows) {
    if (row.event_type !== "created") {
      out.push(row);
      continue;
    }
    const key = row.tx_hash.toLowerCase();
    if (!cache.has(key)) {
      cache.set(
        key,
        await isLoanTxSuccessful(row.tx_hash, parseChainKey(row.chain_key))
      );
    }
    if (cache.get(key)) {
      out.push(row);
    }
  }

  return out;
}
