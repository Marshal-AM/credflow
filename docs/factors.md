Great question. Here's a comprehensive breakdown, ordered by importance:

---

## On-chain behaviour (from Aave on both testnets)

**Repayment signals** — highest weight, most predictive
- Total borrows count vs total repays count → repay ratio
- For each borrow: did a repay follow? How long after? (blocks between borrow and repay)
- Any partial repays vs full repays
- Liquidation count — even 1 is a serious red flag

**Collateral signals**
- Total supplied vs total withdrawn
- Net collateral position over time (are they building or draining it?)
- Did they withdraw collateral shortly before borrowing? (risky pattern)
- Collateral diversity — how many different assets supplied

**Borrow patterns**
- Average borrow size relative to collateral supplied (implied LTV behaviour)
- Frequency of borrows — are they a repeat borrower or one-time?
- Do they borrow and immediately withdraw/bridge? (suspicious pattern)

---

## Wallet-level signals (from raw chain data via Alchemy)

**Age and history**
- Wallet first-ever transaction timestamp → wallet age in days
- Total transaction count across the wallet's lifetime
- Longest gap between transactions (inactive wallets are riskier)

**Activity consistency**
- Number of active months in the last 6 months
- Is activity recent or did it stop suddenly?

**Contract diversity**
- How many unique contracts has this wallet interacted with?
- Has it interacted with other DeFi protocols beyond Aave? (Uniswap, Compound, etc.)
- Breadth of on-chain activity signals a real user vs a fresh wallet gaming the system

---

## Red flag signals (instant score penalties)

| Signal | Why it matters |
|---|---|
| Liquidated even once | Couldn't manage risk |
| Wallet age < 7 days | Likely created to game the system |
| Zero repays but multiple borrows | Never paid anything back |
| All activity in a single burst | Bot-like or fabricated history |
| Borrow → immediate large transfer out | Extractive behaviour |
| Only interacted with Aave, nothing else | Thin, suspicious profile |

---

## Suggested feature list to actually compute

```
wallet_age_days
total_tx_count
unique_contracts_interacted
active_months_last_6

aave_supply_count
aave_withdraw_count
aave_borrow_count
aave_repay_count
aave_liquidation_count

repay_ratio                    → repay_count / borrow_count
avg_blocks_to_repay            → avg(repay_block - preceding_borrow_block)
collateral_withdraw_before_borrow_count
net_collateral_position        → total_supplied - total_withdrawn
borrow_diversity               → unique assets borrowed
collateral_diversity           → unique assets supplied

has_been_liquidated            → boolean, hard penalty
wallet_age_flag                → boolean, age < 7 days
```

---

## What to ignore (for testnet scoring)

- Token prices / USD values — testnet tokens have no real value, so amounts in USD are meaningless. Focus on **counts, ratios, and time patterns** instead
- Gas costs — not meaningful on testnet
- NFT holdings — irrelevant for credit scoring

---

## Implemented in CredScore (27 XGBoost inputs)

| Feature | Source |
|---|---|
| `wallet_age_days` | Earliest transfer timestamp (hub + spoke Alchemy) |
| `tx_count` | RPC nonce sum across chains |
| `unique_contracts_interacted` | Distinct `to` addresses from outbound transfers |
| `active_months_last_6` | Distinct months with activity in last 180 days |
| `days_since_last_active` | Days since most recent transfer |
| `longest_inactive_gap_days` | Longest gap between consecutive transfers |
| `eth_balance` | Native ETH sum across chains |
| `aave_supply_count` | Aave Supply events (+ hub collateral via CredFlow) |
| `aave_withdraw_count` | Aave Withdraw events |
| `aave_borrow_count` | Aave Borrow + CredFlow `LoanCreated` |
| `aave_repay_count` | Aave Repay + CredFlow `LoanRepaid` |
| `aave_liquidation_count` | Liquidation events |
| `repay_ratio` | `aave_repay_count / aave_borrow_count` |
| `avg_blocks_to_repay` | Mean blocks from borrow → repay |
| `avg_loan_duration_days` | Mean days from borrow → repay |
| `collateral_withdraw_before_borrow_count` | Withdraw tx before a borrow |
| `net_collateral_position` | `supply_count - withdraw_count` |
| `borrow_diversity` | Unique assets borrowed |
| `collateral_diversity` | Unique assets supplied |
| `partial_repay_count` | Borrows closed via multiple repay txs |
| `partial_repay_ratio` | `partial_repay_count / aave_borrow_count` |
| `has_been_liquidated` | Red flag: any liquidation |
| `wallet_age_flag` | Red flag: `wallet_age_days < 7` |
| `zero_repays_multiple_borrows_flag` | Red flag: ≥2 borrows, 0 repays |
| `burst_activity_flag` | Red flag: ≥50% of txs in a 7-day window |
| `aave_only_wallet_flag` | Red flag: only touched lending pools |
| `borrow_then_transfer_out_flag` | Red flag: transfer within 50 blocks after borrow |

**CredScore formula:** `clamp(300 + (1 - default_probability) × 550, 300, 850)` where `default_probability` comes from XGBoost on the features above.

**Code:** `indexer/scoring_metrics.py` → `ml/feature_engineering.py` → `ml/train_model.py`

---

## Reclaim bank balance + on-chain CredScoreEngine (optional)

When `RECLAIM_ENABLED=1`, underwriting requires a Reclaim proof of bank balance (INR from IndusInd provider). Flow:

1. `POST /score` with `require_reclaim: true` → returns `reclaim_url` + `reclaim_session_id`
2. User completes Reclaim on mobile → `POST /reclaim/callback` verifies proof
3. API re-runs XGBoost and computes **on-chain preview** via `CredScoreEngine` formula
4. Underwriter agent calls `CredScoreEngine.mintScore()` on Robinhood testnet

**INR → USD:** parsed off-chain in `ml/reclaim_service.py`; live rate from exchangerate.host with `INR_PER_USD` fallback.

**On-chain capacity factor** (`balanceUsdCents`):

| Verified balance (USD) | Factor (bps) | Effect on default_prob |
|------------------------|--------------|-------------------------|
| &lt; $100 | 10000 | none |
| $100 – $999 | 9800 | up to ~2% reduction |
| $1k – $4.9k | 9600 | up to ~4% reduction |
| $5k+ | 9200 | up to ~8% reduction |

**Final on-chain score:**

```
adjusted_prob = default_prob × (factor / 10000)
cred_score = clamp(300 + (1 - adjusted_prob) × 550, 300, 850)
```

**Contracts:** `CredScoreEngine.sol` (formula + mint) → `CredScoreSBT.sol` (profile storage). Lending reads `profile.score` unchanged.

---
