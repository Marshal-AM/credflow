export type DetailLine = {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  href?: string;
};

export type DetailCard = {
  id: string;
  title: string;
  lines: DetailLine[];
};

function fmt(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof value === "string") return value.trim() ? value : null;
  return String(value);
}

function fmtDays(value: unknown): string | null {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return `${n.toFixed(4)} days`;
}

function pct(value: unknown): string | null {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return `${(n * 100).toFixed(2)}%`;
}

function bpsToPct(bps: unknown): string | null {
  const n = Number(bps);
  if (Number.isNaN(n)) return null;
  return `${(n / 100).toFixed(2)}%`;
}

function usdCents(cents: unknown): string | null {
  const n = Number(cents);
  if (Number.isNaN(n) || n <= 0) return null;
  return `$${(n / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toneForApproved(approved: unknown): DetailLine["tone"] {
  if (approved === true) return "positive";
  if (approved === false) return "negative";
  return "neutral";
}

function toneForRisk(risk: unknown): DetailLine["tone"] {
  const r = String(risk ?? "").toLowerCase();
  if (r === "low") return "positive";
  if (r === "high") return "negative";
  return "neutral";
}

function row(
  label: string,
  value: unknown,
  opts?: { tone?: DetailLine["tone"]; href?: string }
): DetailLine | null {
  const formatted =
    typeof value === "string" && (value.startsWith("http") || value.startsWith("ipfs://"))
      ? value
      : fmt(value);
  if (formatted == null) return null;
  const href = opts?.href ?? hrefFor(label, formatted);
  return { label, value: formatted, tone: opts?.tone, href };
}

function hrefFor(label: string, value: string): string | undefined {
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  if (value.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
  }
  const lower = label.toLowerCase();
  if (lower.includes("ipfs") || lower.includes("cid") || lower.includes("explainer")) {
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|baf[a-z0-9]{50,})$/i.test(value)) {
      return `https://ipfs.io/ipfs/${value}`;
    }
  }
  return undefined;
}

function pushCard(cards: DetailCard[], card: DetailCard | null) {
  if (card && card.lines.length > 0) cards.push(card);
}

function compactLines(lines: Array<DetailLine | null>): DetailLine[] {
  return lines.filter((l): l is DetailLine => l != null);
}

function formatChains(chains: unknown): string | null {
  if (!Array.isArray(chains) || chains.length === 0) return null;
  return (chains as string[]).map((c) => c.replace(/_/g, " ")).join(", ");
}

function humanFeature(name: string): string {
  return name.replace(/_/g, " ");
}

function maxLtvForScore(score: number): string {
  if (score >= 750) return "Up to 75%";
  if (score >= 670) return "Up to 65%";
  if (score >= 580) return "Up to 55%";
  return "Up to 45%";
}

function activeRedFlagRows(flags: Record<string, unknown> | undefined): DetailLine[] {
  if (!flags) return [];
  const labels: Record<string, string> = {
    has_been_liquidated: "Prior liquidation",
    wallet_age_flag: "Very new wallet",
    zero_repays_multiple_borrows_flag: "Multiple borrows, no repays",
    burst_activity_flag: "Burst activity pattern",
    aave_only_wallet_flag: "Lending-pool-only wallet",
    borrow_then_transfer_out_flag: "Borrow then transfer out",
  };
  return compactLines(
    Object.entries(flags)
      .filter(([, v]) => v === 1 || v === true || v === "1")
      .map(([key]) =>
        row(labels[key] ?? humanFeature(key), "Detected", { tone: "negative" })
      )
  );
}

function repayRatioLabel(ratio: unknown): string | null {
  const n = Number(ratio);
  if (Number.isNaN(n)) return null;
  return `${(n * 100).toFixed(0)}%`;
}

function borrowPartRow(label: string, value: unknown): DetailLine | null {
  const n = Number(value);
  if (value == null || Number.isNaN(n) || n === 0) return null;
  return row(label, n > 0 ? `+${n}` : String(n), {
    tone: n > 0 ? "positive" : "negative",
  });
}

/** Curated dashboard cards — no CredScore numbers (shown on gauge). */
export function buildScoreRunDetailCards(
  response: Record<string, unknown> | null | undefined,
  context?: {
    minted?: boolean;
    mintTxHash?: string | null;
    sbtTokenId?: string | null;
    sbtLink?: string | null;
  }
): DetailCard[] {
  if (!response) return [];

  const cards: DetailCard[] = [];
  const sybilRaw = (response.sybil_details ?? response.pipeline) as Record<string, unknown> | undefined;
  const sybil = sybilRaw && typeof sybilRaw === "object" ? sybilRaw : {};
  const pipeline = response.pipeline as Record<string, unknown> | undefined;
  const sourceData = response.source_data as Record<string, unknown> | undefined;
  const breakdown = response.model_breakdown as Record<string, unknown> | undefined;
  const featureGroups = breakdown?.feature_groups as Record<string, Record<string, unknown>> | undefined;
  const features = (response.features_used ?? breakdown?.feature_vector) as
    | Record<string, unknown>
    | undefined;
  const walletFeatures = featureGroups?.wallet_behavior ?? features;
  const credflowFeatures = featureGroups?.credflow_hub ?? features;
  const aaveFeatures = featureGroups?.aave_spokes ?? features;
  const crossFeatures = featureGroups?.cross_protocol ?? features;
  const redFlags = featureGroups?.red_flags ?? features;
  const borrowSub = breakdown?.sub_scores as Record<string, Record<string, unknown>> | undefined;
  const borrowParts = borrowSub?.borrow_sub_score?.parts as Record<string, unknown> | undefined;
  const borrowRaw = borrowSub?.borrow_sub_score?.borrow_raw as Record<string, unknown> | undefined;

  const defaultProb =
    response.default_prob_bps != null
      ? bpsToPct(response.default_prob_bps)
      : pct(response.default_probability);

  const scoreNum = typeof response.cred_score === "number" ? response.cred_score : null;
  const approvalBlock = breakdown?.approval as Record<string, unknown> | undefined;
  const approvalRules = approvalBlock?.rules as Record<string, unknown> | undefined;

  pushCard(cards, {
    id: "eligibility",
    title: "Eligibility",
    lines: compactLines([
      row("Borrowing approved", response.approved, { tone: toneForApproved(response.approved) }),
      response.rejection_reason
        ? row("Rejection reason", response.rejection_reason, { tone: "negative" })
        : null,
      row("Default probability", defaultProb),
      response.default_prob_bps != null ? row("Default prob. (bps)", response.default_prob_bps) : null,
      response.score_floored === true ? row("Score adjustment", "Minimum floor applied") : null,
      approvalRules?.min_cred_score != null
        ? row("Minimum score rule", `≥ ${approvalRules.min_cred_score}`)
        : null,
      row("Sybil gate", "High sybil risk blocks approval"),
    ]),
  });

  if (scoreNum != null) {
    pushCard(cards, {
      id: "borrowing",
      title: "Borrowing terms",
      lines: compactLines([
        row("Max LTV", maxLtvForScore(scoreNum)),
        row("Eligible to borrow", response.approved, { tone: toneForApproved(response.approved) }),
        borrowRaw?.credflow_borrow_count != null && borrowRaw?.credflow_repay_count != null
          ? row(
              "Open CredFlow loan",
              Number(borrowRaw.credflow_borrow_count) > Number(borrowRaw.credflow_repay_count)
                ? "Yes"
                : "No",
              {
                tone:
                  Number(borrowRaw.credflow_borrow_count) > Number(borrowRaw.credflow_repay_count)
                    ? "negative"
                    : "positive",
              }
            )
          : null,
      ]),
    });
  }

  pushCard(cards, {
    id: "wallet",
    title: "Wallet behavior",
    lines: compactLines([
      row("Wallet age", fmtDays(walletFeatures?.wallet_age_days)),
      row("Lifetime transactions", walletFeatures?.tx_count ?? sybil.lifetime_tx_count),
      row("Unique contracts", walletFeatures?.unique_contracts_interacted),
      row("Active months (6 mo)", walletFeatures?.active_months_last_6),
      row("Days since last active", walletFeatures?.days_since_last_active),
      row("Longest inactive gap", fmtDays(walletFeatures?.longest_inactive_gap_days)),
      walletFeatures?.eth_balance != null
        ? row("ETH balance (total)", Number(walletFeatures.eth_balance).toFixed(4))
        : null,
    ]),
  });

  pushCard(cards, {
    id: "defi",
    title: "DeFi activity",
    lines: compactLines([
      row("CredFlow borrows", credflowFeatures?.credflow_borrow_count ?? borrowRaw?.credflow_borrow_count),
      row("CredFlow repays", credflowFeatures?.credflow_repay_count ?? borrowRaw?.credflow_repay_count),
      row("CredFlow liquidations", credflowFeatures?.credflow_liquidation_count),
      row("Aave borrows", aaveFeatures?.aave_borrow_count),
      row("Aave repays", aaveFeatures?.aave_repay_count),
      row("Aave liquidations", aaveFeatures?.aave_liquidation_count),
      row("Total borrows", crossFeatures?.total_borrow_count ?? borrowRaw?.total_borrow_count),
      row("Total repays", crossFeatures?.total_repay_count ?? borrowRaw?.total_repay_count),
      row("Repay ratio", repayRatioLabel(crossFeatures?.repay_ratio ?? borrowRaw?.repay_ratio)),
      row("Multi-protocol borrower", crossFeatures?.multi_protocol_borrow_flag, {
        tone: Number(crossFeatures?.multi_protocol_borrow_flag) ? "positive" : "neutral",
      }),
      row(
        "Avg loan duration",
        crossFeatures?.avg_loan_duration_days != null
          ? fmtDays(crossFeatures.avg_loan_duration_days)
          : borrowRaw?.avg_loan_duration != null
            ? fmtDays(borrowRaw.avg_loan_duration)
            : null
      ),
      row("Partial repays", crossFeatures?.partial_repay_count),
    ]),
  });

  const redFlagLines = activeRedFlagRows(redFlags as Record<string, unknown>);
  if (redFlagLines.length > 0) {
    pushCard(cards, { id: "flags", title: "Risk flags", lines: redFlagLines });
  } else {
    pushCard(cards, {
      id: "flags",
      title: "Risk flags",
      lines: compactLines([row("Status", "No active red flags", { tone: "positive" })]),
    });
  }

  if (borrowParts) {
    const partRows = compactLines([
      borrowPartRow("Repayment bonus", borrowParts.repayment_bonus),
      borrowPartRow("Partial repay bonus", borrowParts.partial_repay_bonus),
      borrowPartRow("Multi-protocol bonus", borrowParts.multi_protocol_bonus),
      borrowPartRow("Open CredFlow penalty", borrowParts.open_credflow_penalty),
      borrowPartRow("Open debt penalty", borrowParts.open_debt_penalty),
      borrowPartRow("Liquidation penalty", borrowParts.liquidation_penalty),
      borrowPartRow("Zero-repay penalty", borrowParts.zero_repay_penalty),
      borrowPartRow("Transfer-out penalty", borrowParts.transfer_out_penalty),
    ]);
    if (partRows.length > 0) {
      pushCard(cards, { id: "borrow-health", title: "Borrow health factors", lines: partRows });
    }
  }

  const sybilRisk = response.sybil_risk ?? sybil.sybil_risk;
  const probs = sybil.sybil_probs as Record<string, number> | undefined;

  pushCard(cards, {
    id: "sybil",
    title: "Sybil screening",
    lines: compactLines([
      row("Risk level", sybilRisk, { tone: toneForRisk(sybilRisk) }),
      row("Screening method", sybil.method),
      row("Wallet connections", sybil.unique_counterparties),
      row("Lifetime transactions", sybil.lifetime_tx_count ?? pipeline?.wallet_tx_count),
      sybil.defaulter_links != null
        ? row("Defaulter links", sybil.defaulter_links, {
            tone: Number(sybil.defaulter_links) > 0 ? "negative" : "positive",
          })
        : null,
      probs ? row("P(low)", `${(probs.low * 100).toFixed(1)}%`) : null,
      probs ? row("P(medium)", `${(probs.medium * 100).toFixed(1)}%`) : null,
      probs
        ? row("P(high)", `${(probs.high * 100).toFixed(1)}%`, {
            tone: probs.high > 0.5 ? "negative" : "neutral",
          })
        : null,
    ]),
  });

  const walletTxs = pipeline?.wallet_tx_count ?? sourceData?.wallet_tx_count;
  const alchemyTxs = pipeline?.alchemy_tx_count ?? sourceData?.alchemy_tx_count;
  const borrowTotal = pipeline?.borrow_total ?? sourceData?.borrow_total;
  const bankBalance = usdCents(response.balance_usd_cents);

  pushCard(cards, {
    id: "activity",
    title: "Data indexed",
    lines: compactLines([
      row("Wallet transactions", walletTxs),
      row("Indexed transfers", alchemyTxs),
      row("Borrow positions found", borrowTotal),
      pipeline?.phase_a_fetch_ms != null
        ? row("Indexer fetch time", `${Math.round(Number(pipeline.phase_a_fetch_ms) / 1000)}s`)
        : null,
      pipeline?.phase_b_parallel_ms != null
        ? row("Analysis time", `${Math.round(Number(pipeline.phase_b_parallel_ms) / 1000)}s`)
        : null,
    ]),
  });

  const walletGraph = response.wallet_graph as Record<string, unknown> | undefined;
  const graphNodes = Number(walletGraph?.num_nodes);
  if (walletGraph && graphNodes > 0) {
    pushCard(cards, {
      id: "graph",
      title: "Transaction network",
      lines: compactLines([
        row("Counterparties screened", walletGraph.unique_counterparties),
        row("Graph nodes", walletGraph.num_nodes),
        row("Graph edges", walletGraph.num_edges),
        row("Defaulter links", walletGraph.defaulter_links, {
          tone: Number(walletGraph.defaulter_links) > 0 ? "negative" : "positive",
        }),
      ]),
    });
  }

  const chains = response.chains_queried as Record<string, unknown> | undefined;
  const chainActivity = response.chain_activity as Record<string, unknown> | undefined;
  const chainLines = compactLines([
    row("Hub chain", chains?.hub),
    row("Spoke chains", formatChains(chains?.spokes)),
    row("Activity on", formatChains(chainActivity?.wallet_chains)),
    row("Borrows on", formatChains(chainActivity?.borrow_chains)),
  ]);
  if (chainLines.length > 0) {
    pushCard(cards, { id: "chains", title: "Chain coverage", lines: chainLines });
  }

  const topRisk = breakdown?.top_risk_factors as Array<Record<string, unknown>> | undefined;
  const topProtective = breakdown?.top_protective_factors as Array<Record<string, unknown>> | undefined;

  if (topRisk?.length) {
    pushCard(cards, {
      id: "risk-factors",
      title: "Top risk drivers",
      lines: compactLines(
        topRisk.slice(0, 5).map((f, i) =>
          row(
            `#${i + 1} ${humanFeature(String(f.feature ?? ""))}`,
            fmt(f.feature_value) ?? "—",
            { tone: "negative" }
          )
        )
      ),
    });
  }

  if (topProtective?.length) {
    pushCard(cards, {
      id: "strengths",
      title: "Top strengths",
      lines: compactLines(
        topProtective.slice(0, 5).map((f, i) =>
          row(
            `#${i + 1} ${humanFeature(String(f.feature ?? ""))}`,
            fmt(f.feature_value) ?? "—",
            { tone: "positive" }
          )
        )
      ),
    });
  }

  const sbtExplorerHref = context?.sbtLink ?? undefined;

  pushCard(cards, {
    id: "credential",
    title: "On-chain credential",
    lines: compactLines([
      row("SBT minted", context?.minted ?? false, {
        tone: context?.minted ? "positive" : "neutral",
      }),
      context?.minted && context.sbtTokenId
        ? row("Token ID", `#${context.sbtTokenId}`)
        : null,
      sbtExplorerHref
        ? row("SBT link", "View here", { href: sbtExplorerHref, tone: "positive" })
        : null,
      row("Network", "Robinhood hub"),
      row("Token type", "Soulbound"),
      row("Cross-chain sync", context?.minted ? "Synced to spokes" : "Available after mint", {
        tone: context?.minted ? "positive" : "neutral",
      }),
    ]),
  });

  const reclaim = response.reclaim as Record<string, unknown> | undefined;
  const reclaimLines = compactLines([
    row("Status", reclaim?.verified ?? reclaim?.status ?? (bankBalance ? "Verified" : null)),
    bankBalance ? row("Verified balance", bankBalance, { tone: "positive" }) : null,
    response.reclaim_proof_hash
      ? row("Proof verified", "Yes", { tone: "positive" })
      : null,
  ]);
  if (reclaimLines.length > 0) {
    pushCard(cards, { id: "reclaim", title: "Bank verification", lines: reclaimLines });
  }

  const onChainScoring = breakdown?.on_chain_scoring as Record<string, unknown> | undefined;
  if (onChainScoring) {
    pushCard(cards, {
      id: "bank-scoring",
      title: "Bank-adjusted scoring",
      lines: compactLines([
        usdCents(onChainScoring.balance_usd_cents)
          ? row("Verified balance", usdCents(onChainScoring.balance_usd_cents), { tone: "positive" })
          : null,
        row("Scoring formula", "On-chain CredScoreEngine"),
      ]),
    });
  }

  if (response.shap_cid) {
    const cid = String(response.shap_cid).replace(/^ipfs:\/\//, "");
    pushCard(cards, {
      id: "shap",
      title: "Explainability",
      lines: compactLines([
        row("SHAP explanation", "View on IPFS", {
          href: `https://ipfs.io/ipfs/${cid}`,
        }),
        breakdown?.model_type ? row("Model", breakdown.model_type) : null,
      ]),
    });
  }

  return cards;
}
