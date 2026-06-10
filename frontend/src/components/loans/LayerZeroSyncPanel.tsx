"use client";

import { useEffect, useState } from "react";

type LzBroadcast = {
  id: string;
  message_type: string;
  trigger_source: string;
  hub_score: number | null;
  hub_tx_hashes: Array<{ chain_key: string; eid: number; tx_hash: string; type?: string }>;
  related_onchain_tx: string | null;
  status: string;
  created_at: string;
};

type Props = {
  compact?: boolean;
};

export function LayerZeroSyncPanel({ compact }: Props) {
  const [broadcasts, setBroadcasts] = useState<LzBroadcast[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/loans");
        const data = await res.json();
        if (!cancelled) {
          setBroadcasts(data.layerzero_broadcasts || []);
          setHiddenCount(Number(data.layerzero_broadcasts_hidden ?? 0));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !broadcasts.length) {
    return compact ? null : (
      <p className="text-sm text-zinc-500">Loading cross-chain sync status…</p>
    );
  }

  if (!broadcasts.length) {
    return compact ? null : (
      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">Cross-chain sync (LayerZero)</h3>
        <p className="mt-1 text-xs text-zinc-500">No broadcasts yet — score, mint, or borrow on hub to sync spokes.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-zinc-200 dark:border-zinc-800 ${compact ? "p-4" : "p-6"}`}>
      <h3 className={`font-semibold ${compact ? "text-sm" : ""}`}>Cross-chain sync (LayerZero)</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Hub OApp broadcasts to Arbitrum + Base spokes. Loan sync rows require a successful hub
        borrow/repay tx (reverted triggers are hidden).
      </p>
      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {hiddenCount} stale broadcast{hiddenCount === 1 ? "" : "s"} hidden — linked to a reverted
          on-chain tx (e.g. failed borrow).
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {broadcasts.slice(0, compact ? 3 : 10).map((b) => (
          <li
            key={b.id}
            className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40"
          >
            <div className="flex flex-wrap gap-2">
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                {b.message_type}
              </span>
              <span className="text-zinc-500">{b.trigger_source}</span>
              {b.hub_score != null && <span>score {b.hub_score}</span>}
              <span className="text-zinc-400">{new Date(b.created_at).toLocaleString()}</span>
            </div>
            {(b.hub_tx_hashes || []).map((tx) => (
              <p key={tx.tx_hash} className="mt-1 font-mono break-all text-zinc-700 dark:text-zinc-300">
                {tx.chain_key} (eid {tx.eid}): {tx.tx_hash}
              </p>
            ))}
            {b.related_onchain_tx && (
              <p className="mt-1 text-zinc-500">Trigger tx: {b.related_onchain_tx}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
