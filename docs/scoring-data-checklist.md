# CredFlow Scoring — Data Source Checklist

Track which pipelines return **non-zero / real data** for your test wallet.  
Unchecked items need on-chain activity (or a config fix) before `/score` will reflect them.

---

## Test wallet

| Field | Value |
|---|---|
| **Wallet** | `0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844` |
| **Last live run** | 2026-06-08 (`USE_MOCK_DATA=0`) |
| **CredFlow hub** | Robinhood testnet — chain `46630` |
| **Spokes** | Arbitrum Sepolia `421614`, Base Sepolia `84532` |

### Refresh this checklist

```powershell
# Full pipeline breakdown (per source)
.\credflow-env\Scripts\python.exe scripts\live_integration_test.py

# Full API response (includes chains_queried + chain_activity)
Invoke-RestMethod -Method POST -Uri "http://localhost:8000/score" -ContentType "application/json" -Body '{"wallet_address":"0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844","fhenix_attestation":{"income_above_threshold":true,"balance_above_threshold":true,"repayment_history_clean":true,"account_age_years":3}}'
```

Update the checkboxes below from `features_used`, `chain_activity`, and the integration script output.

**Non-zero rule:** check the box when the source returns a value that affects scoring (not a default like `gmx_sub_score: 50` with `has_gmx_history: 0`, or `repayment_rate: 0.5` with `total_borrows: 0`).

---

## 1. Hub — Robinhood testnet (`46630`)

| Status | Source | Module | Data we need | ML features affected | Last known value | Action if unchecked |
|:---:|---|---|---|---|---|---|
| ☐ | **CredFlow lending events** | `indexer/robinhood_pipeline.py` → `fetch_credflow_lending_features` | `total_borrows`, `on_time_repayments`, `liquidation_count`, `avg_loan_duration`, `max_borrow_usd` | `total_borrows`, `repayment_rate`, `defi_liquidation_count`, `avg_loan_duration_days` | Smoke borrow done — **re-verify** after multi-chain deploy | Borrow + repay on Robinhood: `npm run smoke:borrow` on `CredFlowLending` `0x14d42947929F1ECf882aA6a07dd4279ADb49345d` |
| ☐ | **Robinhood RPC wallet** | `indexer/robinhood_pipeline.py` → `fetch_robinhood_wallet_features` | `tx_count`, `unique_protocols`, `wallet_first_seen` | `tx_count`, `protocol_diversity`, `wallet_age_days` | Hub nonce > 0 expected (deploy + borrow) — **re-verify** | Send a few txs **from** this wallet on Robinhood (transfer, approve, interact with pool) |
| ☐ | **Robinhood RPC balance** | `indexer/alchemy_pipeline.py` (hub RPC) | `eth_balance_wei` | `eth_balance` | `0` on last run | Hold native gas token on Robinhood testnet ([faucet](https://docs.robinhood.com/chain/)) |

**RPC:** `RPC_ROBINHOOD` in `.env`

---

## 2. Spokes — Arbitrum Sepolia (`421614`)

| Status | Source | Module | Data we need | ML features affected | Last known value | Action if unchecked |
|:---:|---|---|---|---|---|---|
| ☐ | **Dune wallet (Arbitrum Sepolia)** | `indexer/dune_pipeline.py` → `arbitrum_sepolia.transactions` | `tx_count`, `unique_protocols`, `wallet_first_seen` | `tx_count`, `protocol_diversity`, `wallet_age_days` | `0` / empty | Send txs **from** wallet on Arbitrum Sepolia; wait ~15–60 min for Dune indexing |
| ☐ | **Dune Aave (Arbitrum)** | `indexer/dune_pipeline.py` → `lending.borrow` (`blockchain='arbitrum'`) | `total_borrows`, liquidations | borrow features | `0` / empty | Borrow on Aave v3 **Arbitrum Sepolia** test market (if available) or mainnet with `INDEX_ARBITRUM_MAINNET=1` |
| ☐ | **Arbitrum Sepolia RPC** | `indexer/alchemy_pipeline.py` | `tx_count`, `eth_balance_wei`, `recent_transactions` | `tx_count`, `eth_balance`, sybil graph | Low / partial | Fund wallet on Arbitrum Sepolia faucet; send txs; enables Alchemy `getAssetTransfers` if using Alchemy RPC |

**Env:** `RPC_ARBITRUM_SEPOLIA`, optional `ALCHEMY_ARBITRUM_SEPOLIA_RPC`, `DUNE_API_KEY`

---

## 3. Spokes — Base Sepolia (`84532`)

| Status | Source | Module | Data we need | ML features affected | Last known value | Action if unchecked |
|:---:|---|---|---|---|---|---|
| ☐ | **Dune wallet (Base Sepolia)** | `indexer/dune_pipeline.py` → `base_sepolia.transactions` | `tx_count`, `unique_protocols`, `wallet_first_seen` | `tx_count`, `protocol_diversity`, `wallet_age_days` | `0` / empty | Send txs **from** wallet on Base Sepolia; wait for Dune indexing |
| ☐ | **Dune Aave (Base)** | `indexer/dune_pipeline.py` → `lending.borrow` (`blockchain='base'`) | `total_borrows`, liquidations | borrow features | `0` / empty | Borrow on Aave v3 Base Sepolia / Base mainnet |
| ☐ | **Base Sepolia RPC** | `indexer/alchemy_pipeline.py` | `tx_count`, `eth_balance_wei`, `recent_transactions` | `tx_count`, `eth_balance`, sybil graph | `0` / empty | Fund wallet on Base Sepolia faucet; send txs |

**Env:** `RPC_BASE_SEPOLIA`, optional `ALCHEMY_BASE_SEPOLIA_RPC`, `DUNE_API_KEY`

---

## 4. Cross-chain reputation — Arbitrum mainnet (`42161`)

GMX does **not** exist on Robinhood or Sepolia testnets. This block is optional (`INDEX_ARBITRUM_MAINNET=1` in `.env`).

| Status | Source | Module | Data we need | ML features affected | Last known value | Action if unchecked |
|:---:|---|---|---|---|---|---|
| ☐ | **GMX v2 history** | `indexer/gmx_module.py` → GMX Subsquid GraphQL | `has_gmx_history`, `gmx_sub_score`, `gmx_liquidation_count`, `gmx_avg_leverage`, `gmx_total_positions` | all `gmx_*` features | `has_gmx_history: 0`, `gmx_sub_score: 50` (default) | Open + close a small perp on [GMX Arbitrum mainnet](https://app.gmx.io) with this wallet |
| ☐ | **Dune Aave (Arbitrum mainnet)** | `indexer/dune_pipeline.py` → `lending.borrow` | Aave borrow history | borrow features | `0` / empty | Borrow on Aave v3 Arbitrum mainnet |
| ☐ | **Arbitrum mainnet RPC** | `indexer/alchemy_pipeline.py` | balance + transfers | `eth_balance`, sybil graph | `tx_count: 3`, `eth_balance: 0` (last run) | Bridge/fund ETH on Arbitrum mainnet; more outbound txs |

**Env:** `ALCHEMY_ARBITRUM_RPC`, `GMX_SUBGRAPH`, `INDEX_ARBITRUM_MAINNET=1`

---

## 5. Off-chain inputs (no chain tx required)

| Status | Source | How it arrives | Data we need | ML features / sub-score | Last known value | Action if unchecked |
|:---:|---|---|---|---|---|---|
| ☑ | **Fhenix attestation** | `POST /score` → `fhenix_attestation` | income / balance / repayment booleans, `account_age_years` | `fhenix_*` features, `fhenix_sub_score` | All `true`, 3 years → sub-score **96** | Pass attestation in `/score` body (Phase 3: live Fhenix proof) |
| ☑ | **Pinata IPFS** | `ml/ipfs_pinata.py` after scoring | Real `shap_cid` | SBT metadata only (not ML input) | Real CID e.g. `ipfs://QmYyv82…` | Set `PINATA_API_KEY` + `PINATA_SECRET_KEY` in `.env` |
| ☑ | **Sybil detector** | `ml/sybil_detector.py` | `recent_transactions` graph | Gates `approved` (not a feature) | `sybil_risk: low` | Needs `recent_transactions` from Alchemy on at least one chain |

---

## 6. ML feature checklist (17 model inputs)

Check when `features_used` in `/score` shows a **non-default** value.

| Status | Feature | Default when missing | Your last known | Fed by |
|:---:|---|---|---|---|
| ☐ | `wallet_age_days` | `0` | `0` | Dune wallet + Robinhood RPC |
| ☐ | `tx_count` | `0` | `3` (Alchemy aggregate) | Alchemy/RPC all chains |
| ☐ | `protocol_diversity` | `0` | `0` | Dune wallet queries |
| ☐ | `total_borrows` | `0` | `0` (re-verify after hub indexer) | CredFlow Robinhood + Dune Aave |
| ☐ | `repayment_rate` | `0.5` (neutral default) | `0.5` | Needs `total_borrows > 0` |
| ☐ | `defi_liquidation_count` | `0` | `0` | CredFlow liquidations + Dune Aave |
| ☐ | `avg_loan_duration_days` | `0` | `0` | CredFlow event timestamps |
| ☐ | `eth_balance` | `0` | `0` | Alchemy/RPC all chains |
| ☐ | `gmx_sub_score` | `50` | `50` | GMX module (needs real history for ≠50) |
| ☐ | `gmx_liquidation_count` | `0` | `0` | GMX module |
| ☐ | `gmx_avg_leverage` | `0` | `0` | GMX module |
| ☐ | `gmx_total_positions` | `0` | `0` | GMX module |
| ☐ | `has_gmx_history` | `0` | `0` | GMX module |
| ☑ | `fhenix_income_verified` | `0` | `1` | Request body |
| ☑ | `fhenix_balance_verified` | `0` | `1` | Request body |
| ☑ | `fhenix_repayment_clean` | `0` | `1` | Request body |
| ☑ | `fhenix_account_age_years` | `0` | `3` | Request body |

---

## 7. Display sub-scores (API only — not XGBoost inputs)

| Status | Sub-score | Last known | Driven by |
|:---:|---|---|---|
| ☐ | `wallet_sub_score` | `38` | Wallet age, txs, diversity, repayment, liquidations, ETH balance |
| ☐ | `gmx_sub_score` | `50` | GMX module (neutral without history) |
| ☑ | `fhenix_sub_score` | `96` | Fhenix attestation booleans |

---

## 8. Suggested tx order (fill unchecked boxes fastest)

Do these in order for wallet `0x2514844…6844`:

1. **Robinhood hub (highest impact for CredFlow demo)**
   - [ ] Confirm smoke borrow indexed: `npm run smoke:borrow` (borrow + repay if possible)
   - [ ] 2–3 extra txs on Robinhood (pool deposit, transfer)

2. **Arbitrum Sepolia spoke**
   - [ ] Fund from [Arbitrum Sepolia faucet](https://faucet.quicknode.com/arbitrum/sepolia)
   - [ ] Send 3+ outbound txs to distinct contracts

3. **Base Sepolia spoke**
   - [ ] Fund from Base Sepolia faucet
   - [ ] Send 3+ outbound txs

4. **Arbitrum mainnet (optional reputation)**
   - [ ] Small GMX open/close
   - [ ] Optional Aave borrow

5. **Re-score**
   - [ ] `USE_MOCK_DATA=0`
   - [ ] Run `scripts/live_integration_test.py`
   - [ ] Update checkboxes in this file from output

---

## 9. API fields to inspect

After each run, confirm non-zero activity in:

```json
{
  "features_used": { "...": "all 17 features" },
  "chain_activity": {
    "wallet_chains": ["robinhood_testnet", "arbitrum_sepolia", ...],
    "borrow_chains": ["robinhood_testnet", "dune_aave", ...],
    "gmx_chain": "arbitrum_mainnet"
  },
  "chains_queried": {
    "hub": "robinhood_testnet",
    "spokes": ["arbitrum_sepolia", "base_sepolia"],
    "gmx_reputation": "arbitrum_mainnet"
  }
}
```

---

## 10. Environment prerequisites

| Variable | Required for |
|---|---|
| `USE_MOCK_DATA=0` | All live data |
| `RPC_ROBINHOOD` | Hub lending + wallet |
| `CREDFLOW_LENDING_ADDRESS` | Hub borrow events (defaults from `docs/addresses.json`) |
| `RPC_ARBITRUM_SEPOLIA` / `RPC_BASE_SEPOLIA` | Spoke RPC stats |
| `DUNE_API_KEY` | Spoke wallet + Aave aggregation |
| `ALCHEMY_API_KEY` | Multi-chain RPC + transfer history |
| `INDEX_ARBITRUM_MAINNET=1` | GMX + mainnet Aave reputation |
| `PINATA_API_KEY` + `PINATA_SECRET_KEY` | Real `shap_cid` |

---

## Changelog

| Date | Notes |
|---|---|
| 2026-06-08 | Initial checklist. Live run: Fhenix + Pinata + Sybil OK; Dune spokes + GMX empty; Alchemy `tx_count=3`; hub CredFlow lending **pending re-verify** after multi-chain indexer. |
