import type { Hash } from "viem";
import { getPublicClient } from "@/lib/loan-server";

const LOAN_TRIGGER_SOURCES = new Set(["loan_created", "loan_repaid"]);

export type LzBroadcastRow = {
  id: string;
  related_onchain_tx: string | null;
  trigger_source: string;
  message_type: string;
  status?: string;
  [key: string]: unknown;
};

export async function isHubTxSuccessful(txHash: string): Promise<boolean> {
  try {
    const client = getPublicClient("hub");
    const receipt = await client.getTransactionReceipt({
      hash: txHash as Hash,
    });
    return receipt.status === "success";
  } catch {
    return false;
  }
}

/** Drop LZ rows whose related hub borrow/repay tx reverted (stale bad syncs). */
export async function filterValidLzBroadcasts<T extends LzBroadcastRow>(
  rows: T[]
): Promise<{ visible: T[]; hiddenCount: number }> {
  const cache = new Map<string, boolean>();
  const visible: T[] = [];
  let hiddenCount = 0;

  async function triggerOk(tx: string): Promise<boolean> {
    const key = tx.toLowerCase();
    if (!cache.has(key)) {
      cache.set(key, await isHubTxSuccessful(tx));
    }
    return cache.get(key)!;
  }

  for (const row of rows) {
    const tx = row.related_onchain_tx;
    if (!tx || !LOAN_TRIGGER_SOURCES.has(row.trigger_source)) {
      visible.push(row);
      continue;
    }
    if (await triggerOk(tx)) {
      visible.push(row);
    } else {
      hiddenCount += 1;
    }
  }

  return { visible, hiddenCount };
}

export async function filterValidLoanEvents<
  T extends { tx_hash: string; event_type: string },
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
      cache.set(key, await isHubTxSuccessful(row.tx_hash));
    }
    if (cache.get(key)) {
      out.push(row);
    }
  }

  return out;
}
