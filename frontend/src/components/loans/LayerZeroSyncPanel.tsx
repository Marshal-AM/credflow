"use client";

import { useEffect, useState } from "react";
import { useWalletApi } from "@/hooks/use-wallet-api";

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
  const { address, apiFetch } = useWalletApi();
  const [broadcasts, setBroadcasts] = useState<LzBroadcast[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch("/api/loans");
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
  }, [address, apiFetch]);

  if (loading && !broadcasts.length) {
    return compact ? null : (
      <p className="text-sm text-muted-foreground">Loading cross-chain sync status…</p>
    );
  }

  if (!broadcasts.length) {
    return compact ? null : (
      <div className="card-padded">
        <h3 className="text-sm font-[650]">Cross-chain sync (LayerZero)</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          No broadcasts yet — score, mint, or borrow on hub to sync spokes.
        </p>
      </div>
    );
  }

  return (
    <div className={`card-padded ${compact ? "" : ""}`}>
      <h3 className={`font-[650] ${compact ? "text-sm" : ""}`}>Cross-chain sync (LayerZero)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Hub OApp broadcasts to Arbitrum + Base spokes. Loan sync rows require a successful hub
        borrow/repay tx (reverted triggers are hidden).
      </p>
      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-amber-400">
          {hiddenCount} stale broadcast{hiddenCount === 1 ? "" : "s"} hidden — linked to a reverted
          on-chain tx (e.g. failed borrow).
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {broadcasts.slice(0, compact ? 3 : 10).map((b) => (
          <li key={b.id} className="surface-row p-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                {b.message_type}
              </span>
              <span className="text-muted-foreground">{b.trigger_source}</span>
              {b.hub_score != null && <span>score {b.hub_score}</span>}
              <span className="text-subtle">{new Date(b.created_at).toLocaleString()}</span>
            </div>
            {(b.hub_tx_hashes || []).map((tx) => (
              <p key={tx.tx_hash} className="mt-1 font-mono break-all text-foreground/80">
                {tx.chain_key} (eid {tx.eid}): {tx.tx_hash}
              </p>
            ))}
            {b.related_onchain_tx && (
              <p className="mt-1 text-muted-foreground">Trigger tx: {b.related_onchain_tx}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
