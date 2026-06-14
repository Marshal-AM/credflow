"use client";

import { useState } from "react";

type Props = {
  data: Record<string, unknown>;
};

function labelize(key: string): string {
  return key.replace(/_/g, " ");
}

function formatPipelineValue(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const ms = obj.analysis_ms ?? obj.sybil_analysis_ms ?? obj.wallet_analysis_ms;
    if (typeof ms === "number") return ms;
    return JSON.stringify(value);
  }
  return String(value ?? "—");
}

function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-shell overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-[650] transition-colors hover:bg-muted/30"
      >
        {title}
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-border/60 px-4 py-3">{children}</div>
      )}
    </div>
  );
}

function KeyValueTable({ rows }: { rows: [string, string | number][] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-border/40">
              <td className="py-1.5 pr-4 text-muted-foreground">{labelize(k)}</td>
              <td className="py-1.5 font-mono text-xs">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountScoreDetails({ data }: Props) {
  const shap = (data.shap_values as Record<string, number>) || {};
  const features = (data.features_used as Record<string, number>) || {};
  const reclaim = (data.reclaim as Record<string, unknown>) || {};
  const modelBreakdown = (data.model_breakdown as Record<string, unknown>) || {};
  const sourceData = (data.source_data as Record<string, unknown>) || {};
  const sourceSummary = (sourceData.summary as Record<string, unknown>) || {};
  const sources = (sourceData.sources as Record<string, Record<string, unknown>>) || {};
  const sybilDetails = (data.sybil_details as Record<string, unknown>) || {};
  const sybilProbs = (sybilDetails.sybil_probs as Record<string, number>) || {};
  const pipeline = (data.pipeline as Record<string, unknown>) || {};
  const formula = (modelBreakdown.formula as Record<string, unknown>) || {};
  const computed = (formula.computed as Record<string, number>) || {};

  const topShap = Object.entries(shap)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 12);

  const featureRows = Object.entries(features)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) : String(v)] as [string, string | number]);

  const sourceRows = Object.entries(sources).map(([id, src]) => {
    const inner = (src.data as Record<string, unknown>) || {};
    const bits = [
      src.chain ? `chain=${src.chain}` : null,
      src.backend ? `backend=${src.backend}` : null,
      src.skipped ? "skipped" : null,
      inner.tx_count != null ? `tx=${inner.tx_count}` : null,
      inner.unique_protocols != null ? `protocols=${inner.unique_protocols}` : null,
      inner.borrow_count != null ? `borrows=${inner.borrow_count}` : null,
    ].filter(Boolean);
    return [id, bits.join(" · ") || (src.has_data ? "has data" : "empty")] as [string, string];
  });

  const defaultProb = data.default_probability as number | undefined;
  const defaultBps = data.default_prob_bps as number | undefined;

  return (
    <div className="space-y-4">
      {(defaultProb != null || defaultBps != null) && (
        <div className="card-padded">
          <h3 className="font-[650]">Default risk (ML)</h3>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {defaultProb != null && (
              <p>
                <span className="text-muted-foreground">Default probability:</span>{" "}
                <strong>{(defaultProb * 100).toFixed(2)}%</strong>
              </p>
            )}
            {defaultBps != null && (
              <p>
                <span className="text-muted-foreground">Default prob (bps):</span>{" "}
                <strong>{defaultBps}</strong>
              </p>
            )}
          </div>
          {Object.keys(computed).length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              Formula: {String(formula.step_2_cred_score || "300 + (1 − p_default) × 550")}
              {computed.raw_cred_score_before_clamp != null && (
                <span className="ml-2">
                  → raw {computed.raw_cred_score_before_clamp.toFixed(1)} → {computed.cred_score}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {Object.keys(sybilProbs).length > 0 && (
        <div className="card-padded">
          <h3 className="font-[650]">Sybil probability breakdown</h3>
          <div className="mt-4 space-y-2">
            {(["low", "medium", "high"] as const).map((tier) => {
              const p = sybilProbs[tier] ?? 0;
              return (
                <div key={tier} className="flex items-center gap-3 text-sm">
                  <span className="w-16 capitalize text-muted-foreground">{tier}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${
                        tier === "high"
                          ? "bg-red-400"
                          : tier === "medium"
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                      }`}
                      style={{ width: `${Math.min(100, p * 100)}%` }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-xs">{(p * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Object.keys(reclaim).length > 0 && (
        <div className="card-padded">
          <h3 className="font-[650]">Reclaim verification</h3>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Status:</span>{" "}
              <strong>{String(reclaim.status || "—")}</strong>
            </p>
            {reclaim.balance_inr_paise != null && (
              <p>
                <span className="text-muted-foreground">Balance (INR):</span>{" "}
                ₹{(Number(reclaim.balance_inr_paise) / 100).toLocaleString()}
              </p>
            )}
            {reclaim.fx_rate_inr_per_usd != null && (
              <p>
                <span className="text-muted-foreground">FX rate:</span>{" "}
                {Number(reclaim.fx_rate_inr_per_usd)} INR/USD ({String(reclaim.fx_source || "—")})
              </p>
            )}
            {reclaim.reclaim_proof_hash != null && (
              <p className="col-span-full font-mono text-xs break-all text-muted-foreground">
                Proof hash: {String(reclaim.reclaim_proof_hash)}
              </p>
            )}
          </div>
        </div>
      )}

      {Object.keys(pipeline).length > 0 && (
        <Collapsible title="Pipeline timing (ms)" defaultOpen>
          <KeyValueTable
            rows={Object.entries(pipeline).map(([k, v]) => [k, formatPipelineValue(v)])}
          />
        </Collapsible>
      )}

      {topShap.length > 0 && (
        <Collapsible title={`SHAP drivers (top ${topShap.length})`} defaultOpen>
          <p className="mb-3 text-xs text-muted-foreground">
            Positive SHAP → higher default risk; negative → lower default risk.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2">Feature</th>
                <th className="pb-2">SHAP</th>
              </tr>
            </thead>
            <tbody>
              {topShap.map(([k, v]) => (
                <tr key={k} className="border-t border-border/40">
                  <td className="py-1.5">{labelize(k)}</td>
                  <td
                    className={`py-1.5 font-mono text-xs ${
                      v > 0 ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {v > 0 ? "+" : ""}
                    {v.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Collapsible>
      )}

      {featureRows.length > 0 && (
        <Collapsible title={`ML features (${featureRows.length})`}>
          <KeyValueTable rows={featureRows} />
        </Collapsible>
      )}

      {Object.keys(sourceSummary).length > 0 && (
        <Collapsible title="Data sources">
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-3">
            <p>
              <span className="text-muted-foreground">Total sources:</span>{" "}
              {String(sourceSummary.total_sources ?? "—")}
            </p>
            <p>
              <span className="text-muted-foreground">With data:</span>{" "}
              {String(sourceSummary.sources_with_data ?? "—")}
            </p>
            <p>
              <span className="text-muted-foreground">Skipped:</span>{" "}
              {String(sourceSummary.sources_skipped ?? "—")}
            </p>
          </div>
          {sourceRows.length > 0 && <KeyValueTable rows={sourceRows} />}
        </Collapsible>
      )}

      {modelBreakdown.model_type != null && (
        <Collapsible title="Model metadata">
          <KeyValueTable
            rows={[
              ["model_type", String(modelBreakdown.model_type)],
              ["factors_reference", String(modelBreakdown.factors_reference || "—")],
              ["feature_count", String((modelBreakdown.feature_columns as string[])?.length ?? "—")],
            ]}
          />
        </Collapsible>
      )}
    </div>
  );
}
