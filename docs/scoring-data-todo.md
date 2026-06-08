# CredFlow — On-chain TODO (populate scoring data)

Wallet: **`0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844`**  
Goal: make every unchecked row in [`scoring-data-checklist.md`](./scoring-data-checklist.md) return non-zero data.

> **Important:** GMX and Dune `lending.borrow` (Aave) index **Arbitrum/Base mainnet**, not Sepolia.  
> Sepolia work fills **wallet / RPC / sybil** data. Mainnet steps are in **Phase 4** for GMX + Aave.

---

## Before you start

- [ ] `.env` has `USE_MOCK_DATA=0`
- [ ] `.env` RPCs set:
  ```env
  RPC_ARBITRUM_SEPOLIA=https://sepolia-rollup.arbitrum.io/rpc
  RPC_BASE_SEPOLIA=https://sepolia.base.org
  ALCHEMY_ARBITRUM_SEPOLIA_RPC=https://arb-sepolia.g.alchemy.com/v2/<ALCHEMY_API_KEY>
  ALCHEMY_BASE_SEPOLIA_RPC=https://base-sepolia.g.alchemy.com/v2/<ALCHEMY_API_KEY>
  ```
- [ ] Import deployer key into MetaMask (or Rabby) — same address on all EVM chains
- [ ] Add custom networks if missing:

| Network | Chain ID | RPC |
|---|---|---|
| Arbitrum Sepolia | `421614` | `https://sepolia-rollup.arbitrum.io/rpc` |
| Base Sepolia | `84532` | `https://sepolia.base.org` |
| Robinhood testnet | `46630` | `https://rpc.testnet.chain.robinhood.com` |

---

## Phase 1 — Arbitrum Sepolia (`421614`)

**Unlocks:** Dune `arbitrum_sepolia.transactions`, Arbitrum Sepolia RPC, Alchemy transfers, `tx_count`, `protocol_diversity`, `wallet_age_days`, sybil graph.

### 1.1 Fund the wallet

- [ ] Open [Arbitrum Sepolia faucet](https://faucet.quicknode.com/arbitrum/sepolia) (or [Alchemy Sepolia faucet](https://www.alchemy.com/faucets/arbitrum-sepolia))
- [ ] Request ETH to `0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844`
- [ ] Confirm balance in MetaMask on **Arbitrum Sepolia**

**Verify:** balance > 0 on chain `421614`.

### 1.2 Wallet activity txs (Dune + RPC)

Send all txs **from** `0x2514…6844`. Dune needs outbound txs with different `to` addresses for `protocol_diversity`.

- [ ] **Tx 1** — Simple ETH transfer to any second wallet you control (or a burn address `0x000…dEaD`)
- [ ] **Tx 2** — ETH transfer to a **different** recipient than Tx 1
- [ ] **Tx 3** — ETH transfer to a **third** recipient
- [ ] **Tx 4 (optional)** — Call any live Sepolia contract (e.g. approve an ERC-20, interact with a test dApp)

**Targets after this phase:**

| Field | Expected |
|---|---|
| `chain_activity.wallet_chains` | includes `arbitrum_sepolia` |
| `features_used.tx_count` | increases |
| `features_used.protocol_diversity` | ≥ 3 (after Dune indexes) |
| `features_used.wallet_age_days` | > 0 (after Dune indexes) |

### 1.3 Alchemy transfer history (sybil graph)

- [ ] Confirm `ALCHEMY_ARBITRUM_SEPOLIA_RPC` is set (not only public RPC)
- [ ] Re-run score — `sybil_details.unique_counterparties` should be > 0

### 1.4 Aave on Arbitrum Sepolia (may not hit Dune yet)

Current indexer queries Dune `lending.borrow` with `blockchain='arbitrum'` (**mainnet**). Still worth doing for future / manual verification.

- [ ] Go to [app.aave.com](https://app.aave.com) → switch to **Arbitrum Sepolia** (if listed)
- [ ] Supply a small amount of test collateral (Sepolia ETH or faucet token)
- [ ] Borrow a small amount
- [ ] Repay the borrow (improves `repayment_rate` if indexed)

- [ ] If Dune still shows `total_borrows: 0` after 24h → do **Phase 4.2** (mainnet Aave) instead

### 1.5 Wait for Dune indexing

- [ ] Wait **30–90 minutes** after txs (Dune `performance=small` queries lag on free tier)
- [ ] Run verification (Phase 5)

---

## Phase 2 — Base Sepolia (`84532`)

**Unlocks:** Dune `base_sepolia.transactions`, Base Sepolia RPC, more `tx_count` / `protocol_diversity`.

### 2.1 Fund the wallet

- [x] Open [Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet) or [Alchemy Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia)
- [x] Request ETH to `0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844` — balance **~0.00595 ETH** (checked 2026-06-08)
- [x] Confirm balance on **Base Sepolia**

### 2.2 Wallet activity txs

- [x] **Tx 1** — ETH transfer to recipient A — `0x211efa97…c4151` → `0x70997970…`
- [x] **Tx 2** — ETH transfer to recipient B — `0x49fc2f86…6f00` → `0x3C44CdDdB…`
- [x] **Tx 3** — ETH transfer to recipient C — `0x6158b83f…cbd9f` → `0x…dEaD`
- [x] **Tx 4** — WETH deposit — `0x8d61c6e4…5ada` at `0x4200…0006`

_Run via `npm run base-sepolia:activity` (2026-06-08). Dune indexing pending (~30–90 min)._

**Targets:**

| Field | Expected |
|---|---|
| `chain_activity.wallet_chains` | includes `base_sepolia` |
| `features_used.tx_count` | increases further |
| `features_used.protocol_diversity` | increases further |

### 2.3 Aave on Base Sepolia

- [x] Supply WETH collateral — `0x2a4aab49…5454` (0.001 WETH → aWETH)
- [x] Borrow 0.1 USDC — `0x434f8375…ced6ac`
- [x] Repay USDC debt — `0xabb07887…8299`
- [x] Wrap ETH for supply — `0x3317411d…ef07`

_Run via `npm run base-sepolia:aave` (2026-06-08). Post-flow: `aWETH ≈ 0.001`, debt `0`._

> Dune `lending.borrow` still queries **Base mainnet**, not Base Sepolia. These txs are on-chain for RPC/event indexing; Dune may stay empty until we add Sepolia-specific queries or you borrow on mainnet (Phase 4).

### 2.4 Wait for Dune indexing

- [ ] Wait **30–90 minutes**
- [ ] Run verification (Phase 5)

---

## Phase 3 — Robinhood hub (`46630`) — CredFlow borrow data

Not Sepolia, but required for **`total_borrows`**, **`repayment_rate`**, **`avg_loan_duration_days`** from your own protocol.

### 3.1 CredFlow lending (highest priority for demo)

- [ ] Ensure Robinhood testnet ETH for gas ([Robinhood faucet](https://docs.robinhood.com/chain/))
- [ ] Run borrow smoke test:
  ```powershell
  npm run smoke:borrow
  ```
- [ ] **Repay the loan** when possible (on-chain `repay` on `CredFlowLending` `0x14d42947929F1ECf882aA6a07dd4279ADb49345d`)

**Unlocks:** `fetch_credflow_lending_features` → `total_borrows ≥ 1`, `on_time_repayments`, `avg_loan_duration_days`

### 3.2 Extra hub wallet activity

- [ ] Deposit USDG into `CredFlowLP` pool `0x1E491de1a08843079AAb4cFA516C717597344e50` (or another protocol tx)
- [ ] One native ETH transfer on Robinhood from your wallet

**Unlocks:** Robinhood `tx_count`, hub entry in `chain_activity.wallet_chains`

### 3.3 Verify hub immediately (no Dune wait)

- [ ] Run `.\credflow-env\Scripts\python.exe scripts\live_integration_test.py`
- [ ] Confirm `borrow_chains` includes `robinhood_testnet`

---

## Phase 4 — Arbitrum mainnet (`42161`) — GMX + Dune Aave only

Sepolia **cannot** populate GMX or Dune Aave (`lending.borrow` mainnet). Do this if you want full feature coverage.

### 4.1 Fund mainnet wallet

- [ ] Bridge or buy a small amount of ETH on **Arbitrum One** (mainnet) for the same address
- [ ] Keep amount minimal (gas + tiny position)

### 4.2 Aave v3 Arbitrum mainnet (Dune borrow features)

- [ ] [app.aave.com](https://app.aave.com) → **Arbitrum One**
- [ ] Supply small collateral (e.g. USDC/ETH)
- [ ] Borrow minimum amount
- [ ] Repay within a few days

**Unlocks:** `total_borrows`, `repayment_rate`, `defi_liquidation_count` via Dune `lending.borrow`

### 4.3 GMX v2 Arbitrum mainnet

- [ ] [app.gmx.io](https://app.gmx.io) → Arbitrum → connect `0x2514…6844`
- [ ] Open a **very small** perp position
- [ ] Close the position (realized PnL + history)

**Unlocks:** `has_gmx_history: 1`, `gmx_sub_score ≠ 50`, `gmx_total_positions`, `gmx_avg_leverage`

### 4.4 Extra mainnet txs (optional)

- [ ] 2–3 outbound ETH transfers on Arbitrum mainnet (boosts mainnet `tx_count` in Alchemy aggregate)

---

## Phase 5 — Verify & update checklist

Run after each phase (wait for Dune after Sepolia/mainnet txs).

### 5.1 Integration script

```powershell
cd c:\Users\MSI\Desktop\credflow
.\credflow-env\Scripts\python.exe scripts\live_integration_test.py
```

- [ ] `dune_wallet` → non-empty OR `chains_with_activity` lists sepolia chains
- [ ] `dune_aave` → non-empty OR `borrow_chains` includes `robinhood_testnet` / `dune_aave`
- [ ] `gmx` → `has_gmx_history: true` (after Phase 4.3)
- [ ] `alchemy` → `tx_count` > 0, `recent_tx_count` > 0

### 5.2 Full API score

```powershell
# Start API if not running: npm run ml:serve
$body = '{"wallet_address":"0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"}'
Invoke-RestMethod -Method POST -Uri "http://localhost:8000/score" -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```

Check:

- [ ] `features_used.total_borrows` > 0
- [ ] `features_used.repayment_rate` ≠ 0.5 (only if borrows exist)
- [ ] `features_used.protocol_diversity` > 0
- [ ] `features_used.wallet_age_days` > 0
- [ ] `features_used.has_gmx_history` = 1 (after GMX)
- [ ] `chain_activity.wallet_chains` lists all chains you used
- [ ] `wallet_sub_score` > previous value (~38)

### 5.3 Update checklist doc

- [ ] Open [`scoring-data-checklist.md`](./scoring-data-checklist.md)
- [ ] Change `☐` → `☑` for each source that now returns non-zero data
- [ ] Update **Last known value** column
- [ ] Add a row to **Changelog** with date + what you completed

---

## Quick reference — what each phase fixes

| Phase | Chain | Data sources fixed |
|---|---|---|
| **1** | Arbitrum Sepolia | Dune wallet, RPC, Alchemy transfers, sybil, `tx_count`, `protocol_diversity`, `wallet_age_days` |
| **2** | Base Sepolia | Same as Phase 1 on second spoke |
| **3** | Robinhood hub | CredFlow `total_borrows`, `repayment_rate`, `avg_loan_duration_days`, hub wallet |
| **4** | Arbitrum mainnet | GMX features, Dune Aave borrow history |
| **5** | — | Verification only |

---

## Already done (no txs needed)

- [x] Borrow history — merged from CredFlow hub + spoke Aave RPC + Dune (`borrow_sub_score`)
- [x] Pinata `shap_cid` — `PINATA_API_KEY` + `PINATA_SECRET_KEY` in `.env`
- [x] Sybil low risk — improves with Alchemy `recent_transactions` (Phases 1–2)

---

## Minimum Sepolia-only path (if you skip mainnet)

If you only want Sepolia + Robinhood (no mainnet cost):

1. Complete **Phase 1** + **Phase 2** + **Phase 3**
2. Accept that these stay at defaults until mainnet:
   - `gmx_*` features / `gmx_sub_score: 50`
   - Dune Aave `total_borrows` (unless you add mainnet borrow in Phase 4)

---

## Changelog

| Date | Completed phases | Notes |
|---|---|---|
| | | |
