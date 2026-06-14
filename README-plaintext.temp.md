# CredFlow — Plain-Text Summary (Temp)

Generated from README.md. No diagrams. Summarized sections with links preserved.

---

## Tagline

An undercollateralized lending protocol powered by cross-chain credit scores.

CredFlow turns rich financial signals into a portable CredScore (300–850) that unlocks undercollateralized loans. Connect a wallet and we reconstruct your full DeFi footprint — Aave and Morpho repay history, Alchemy transfer graphs, sybil-risk analysis, and 37 ML features — in minutes. No on-chain history yet? Link a bank account via Reclaim zkTLS and get an accurate score from verified balance and capacity.

Once scored, mint a soulbound CredScore SBT and borrow with less collateral than standard over-collateralized DeFi. Five autonomous agents power the application: underwriting, cross-chain sync, portfolio monitoring, liquidation, and rate optimization.

Borrowing: Robinhood Chain testnet, Arbitrum Sepolia, Base Sepolia. Credit state syncs via LayerZero V2.

---

## Chain Explorers and Parameters

Robinhood Chain testnet (hub)
- Chain ID: 46630
- LayerZero EID: 40451
- RPC: https://rpc.testnet.chain.robinhood.com
- Explorer: https://explorer.testnet.chain.robinhood.com

Arbitrum Sepolia
- Chain ID: 421614
- LayerZero EID: 40231
- Explorer: https://sepolia.arbiscan.io

Base Sepolia
- Chain ID: 84532
- LayerZero EID: 40245
- Explorer: https://sepolia.basescan.org

Address source of truth:
- docs/addresses.json
- docs/spoke-arbitrum-addresses.json
- docs/spoke-base-addresses.json

Robinhood official contracts docs: https://docs.robinhood.com/chain/contracts/

---

## Deployed Contracts (Hub — Robinhood Chain Testnet)

- CredScoreSBT — soulbound credit profile (score, sub-scores, loan status, SHAP CID)
  https://explorer.testnet.chain.robinhood.com/address/0x941380a70Be9322fE1bCa65D13343323c5824359

- CredScoreEngine — on-chain score formula + Reclaim attestation → mint/update SBT
  https://explorer.testnet.chain.robinhood.com/address/0xD8Eeb09C86b6A910DbBcB1D83020Bd4a8dBdAEEb

- CredFlowLending — hub borrow / repay / liquidate; reads SBT for LTV tiers
  https://explorer.testnet.chain.robinhood.com/address/0xe7B1D8BeCE6D3F1F33a65f2534d1AB7E61a7382A

- CredFlowLP — USDG liquidity pool; utilization for rate optimizer
  https://explorer.testnet.chain.robinhood.com/address/0x571DD8F69798BaE3b442077F566e83719F6827aa

- CredFlowOApp — LayerZero broadcaster (score / loan / default / repaid)
  https://explorer.testnet.chain.robinhood.com/address/0x3E39e65fAb3DBbD506c34c6c3a0e8e64994583b4

- ChainlinkOracle — WETH/USD for hub collateral
  https://explorer.testnet.chain.robinhood.com/address/0x0733e87b12c0466460c2eC99ade11C4e0ce542c3

- MockChainlinkFeed (WETH/USD) — testnet price feed
  https://explorer.testnet.chain.robinhood.com/address/0xDE969d906510F98EDA7AFFA3F8D248169a74c2A4

- USDG — hub borrow asset
  https://explorer.testnet.chain.robinhood.com/address/0x7E955252E15c84f5768B83c41a71F9eba181802F

- WETH — hub collateral
  https://explorer.testnet.chain.robinhood.com/address/0x7943e237c7F95DA44E0301572D358911207852Fa

- LayerZero EndpointV2
  https://explorer.testnet.chain.robinhood.com/address/0x3aCAAf60502791D199a5a5F0B173D78229eBFe32

---

## Deployed Contracts (Arbitrum Sepolia)

- CredFlowOApp — mirrors score, loan lock, blacklist from hub
  https://sepolia.arbiscan.io/address/0xebE2fDe0781ea6f57c1F5EDd775Fe8D41b9C6830

- CredFlowSpokeLending — spoke borrow / repay
  https://sepolia.arbiscan.io/address/0xd834854Eb7d064EBb74cED270eb3431f7e816728

- CredFlowLP — USDC pool
  https://sepolia.arbiscan.io/address/0x60BD7ca901f6F23ac0A4D640B3DEeCEDc9135483

- ChainlinkOracle
  https://sepolia.arbiscan.io/address/0x08f18d1257C8665fe6DAD689B8E1Acd9120C374b

- ChainlinkMirrorFeed (WETH/USD)
  https://sepolia.arbiscan.io/address/0xb0cc4Fbe99f7426b5b345008944a23F0db54Bdd6

- WETH
  https://sepolia.arbiscan.io/address/0x1dF462e2712496373A347f8ad10802a5E95f053D

- USDC
  https://sepolia.arbiscan.io/address/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d

- Mainnet Chainlink ETH/USD (mirror source)
  https://arbiscan.io/address/0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612

- CredScoreSBT: not deployed on spokes (hub only)

---

## Deployed Contracts (Base Sepolia)

- CredFlowOApp
  https://sepolia.basescan.org/address/0xB830EC92c606f3ECF03d9fE223F873dA2dbd2620

- CredFlowSpokeLending
  https://sepolia.basescan.org/address/0x99269E64c4Dfb227648E079Bf34E6857B6c300A4

- CredFlowLP
  https://sepolia.basescan.org/address/0x48F669f0AA0271Ef56471841a0BfDED2A71aAc13

- ChainlinkOracle
  https://sepolia.basescan.org/address/0xFed19b2508ac23dDadAE680C005152FC4DE73368

- ChainlinkMirrorFeed (WETH/USD)
  https://sepolia.basescan.org/address/0x76B27936a660C9BC0b25Cb0dF86F394F0dd840F2

- WETH (canonical Base Sepolia)
  https://sepolia.basescan.org/address/0x4200000000000000000000000000000000000006

- USDC
  https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e

- Mainnet Chainlink ETH/USD (mirror source)
  https://basescan.org/address/0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70

- CredScoreSBT: not deployed on spokes (hub only)

---

## 1. Introduction

CredFlow is a credit-first lending product. It starts with knowing the borrower.

For experienced Web3 users: multi-protocol borrow/repay events (Aave V3, Morpho Blue, CredFlow), Alchemy transfer graphs, activity windows, liquidation history, and graph-based sybil detection → FICO-like CredScore with SHAP on IPFS.

For Web3 newcomers: optional Reclaim zkTLS bank verification folds verified balance and capacity into the on-chain score so thin wallets are not auto-rejected.

Approved scores become a CredScore SBT driving LTV tiers, interest rates, and lower collateral vs typical 150%+ DeFi. Five Python agents automate minting, cross-chain propagation, health polling (every 5 min), liquidation/blacklist, and rate tuning.

UI note: primary tabs use a server-side wallet (FRONTEND_PRIVATE_KEY in frontend/.env.local). AppShell routes through /api/wallet and /api/profile.

### Why Robinhood Chain Testnet

EVM-compatible L2 on Arbitrum stack. CredFlow anchors on-chain credit issuance here (CredScore SBT + underwriter agent) because:
- Standard Hardhat/ethers/viem tooling
- Low-cost SBT mints and agent broadcasts
- Native USDG + WETH (official Robinhood testnet tokens)
- Official LayerZero V2 chain (EID 40451)
- Faucet ecosystem for testnet liquidity
- Same CredScore syncs to Arbitrum/Base where Aave/Morpho history is indexed

### Current Scenario (Problem)

Traditional DeFi is over-collateralized regardless of repayment history. Pain points:
- Thin wallet history / sybil farms
- No portable credit across chains
- Siloed risk → double-borrows possible
- Bank capacity invisible without cryptographic verification

### The CredFlow Solution (Six Pillars)

1. Wallet-native credit report — indexers + XGBoost + R-GCN sybil + SHAP on IPFS
2. Bank path for newcomers — Reclaim zkTLS balance proof
3. Portable CredScore SBT — soulbound credit identity
4. Undercollateralized borrowing — LTV 40–85% by score tier
5. Five always-on agents — underwrite, sync, monitor, liquidate, optimize rates
6. Cross-chain credit sync — LayerZero V2 score/loan/default state
7. Supabase — profiles, score runs, loan events, LZ audit rows

### System Architecture (Summary)

Stack: Next.js frontend (AppShell, API routes, wallet-server, loan-server, agent-client) → FastAPI ML engine (port 8000: scoring_api, XGBoost, sybil, Reclaim, indexers, agent_handlers) → five Python agents → Robinhood hub contracts (SBT, Engine, Lending, OApp) → LayerZero V2 → Arbitrum/Base OApp + SpokeLending.

### Full Borrower Journey (Summary)

Phases: Build Credit (optional prep wallet → POST /score → optional Reclaim → mint SBT) → Borrow (hub or spoke; hub triggers crosschain_sync) → Active Loan (portfolio_monitor 300s, rate_optimizer 3600s) → Repay (rescore + underwriter + sync) OR Stress (LTV/overdue → liquidation_agent → MSG_DEFAULT).

Stage summary:
- Prep wallet: Aave/Morpho scripts, no agents
- Score: ML API only
- Score complete: crosschain_sync
- Mint SBT: underwriter → crosschain_sync
- Hub borrow USDG: crosschain_sync (loan_active)
- Spoke borrow USDC: reads OApp, no agent
- Active loan: portfolio_monitor + rate_optimizer
- Repay: scoring API → underwriter → crosschain_sync
- Default: portfolio_monitor → liquidation_agent → crosschain_sync

---

## 2. The Five Agents

Agents live in agents/. HTTP at /agents/* via ml/agent_handlers.py. Scheduler: npm run agents:serve (agents/scheduler.py).

Product roles:
- Underwriter — mint/update CredScore SBT on-chain
- Cross-chain sync — propagate score, loan-active, repaid, default to all markets
- Portfolio monitor — LTV breaches and calendar overdue (every 300s)
- Liquidation — seize collateral, blacklist sybil rings, broadcast defaults
- Rate optimizer — adjust pool baseRate from utilization (every 3600s on hub)

### Underwriter Agent (agents/underwriter_agent.py)

Triggers: POST /api/mint, post-repay rescore, POST /agents/underwrite
Wallet: AGENT_PRIVATE_KEY

Only agent writing CredScoreSBT and CredScoreEngine.

Flow summary: blacklist check → hasProfile guard → fetch score (POST /score or snapshot) → hard rules (sybil high = reject, score < 500 reject, approved false reject) → Groq review for borderline 480–520 → on-chain mint/update (Reclaim path via Engine.mintScore, else SBT direct) → caller triggers sync-score.

Does NOT run on borrow.

### Cross-Chain Sync Agent (agents/sync_service.py, agents/crosschain_sync.py)

Triggers: score complete, mint, hub borrow/repay, scheduler batch
Only writer to hub CredFlowOApp broadcasts.

Functions:
- broadcastScore → MSG_SCORE_UPDATE (1)
- broadcastLoanActive → MSG_LOAN_ACTIVE (2)
- broadcastRepaid → MSG_REPAID (4)
- broadcastDefault → MSG_DEFAULT (3) — via liquidation_agent

Hub borrow sync: verify activeLoanId → read SBT score → broadcastScore + broadcastLoanActive to EIDs 40231 and 40245 (four hub txs total pattern).

Hub repay sync: broadcastScore + broadcastRepaid to both spokes.

LZ options must be non-empty (agents/lz_options.py, layerzero/buildLzOptions.js).

### Portfolio Monitor Agent (agents/portfolio_monitor.py)

Every 300s on hub, Arbitrum, Base (AGENT_MONITOR_INTERVAL_SEC).

Per active loan: getCurrentLTV, check dueTime, Groq escalation → emitHealthWarning at LTV ≥ 75% → hand off to liquidation at LTV ≥ 85% or grace expired.

### Liquidation Agent (agents/liquidation_agent.py)

Triggers: portfolio monitor, POST /agents/liquidate

Steps: verify LTV ≥ 85% (or force_grace + ensure_liquidatable on testnet) → liquidate → hub graph analysis + Groq blacklist → sbt.blacklistLinkedWallets → hub.broadcast_default per wallet. LZ always from hub CredFlowAgent.

### Rate Optimizer Agent (agents/rate_optimizer.py)

Every 3600s on hub. Reads pool utilization + baseRate → Groq rate verdict → hard rules (util > 80% force +10bps, util < 50% force -10bps) → clamp 200–2000 bps → setBaseRate if changed. Individual borrowers still get score-tier rates at loan creation.

### Agent Scheduler and Triggers

Scheduled:
- 300s: portfolio_monitor (hub, arbitrum, base)
- 3600s: rate_optimizer (hub)
- 3600s: crosschain_sync batch (hub)

Event-driven (frontend/src/lib/agent-client.ts):
- Score complete → POST /agents/sync-score
- SBT mint → POST /agents/underwrite then sync-score
- Hub borrow → POST /agents/sync-loan event=created
- Hub repay → sync-loan repaid + rescore + underwrite rescore

Logs: frontend Agents tab (/api/agents, /api/agents/stream).

### Agent Lifecycle Map (Summary)

Score complete → crosschain_sync → broadcastScore
Mint → underwriter → SBT → crosschain_sync
Hub borrow → crosschain_sync → broadcastLoanActive
Hub repay → underwriter rescore → crosschain_sync repaid+score
Scheduler 300s → portfolio_monitor → warnings/liquidation
Scheduler 3600s → rate_optimizer → setBaseRate
LTV/overdue → liquidation_agent → liquidate + broadcastDefault

### Groq LLM Decision Layer (agents/groq_brain.py)

Not a standalone agent — judgment inside four agents. Pydantic schemas; rule fallbacks on API failure.

- review_underwriting (underwriter) — borderline scores
- review_monitor_escalation (portfolio_monitor) — LTV/overdue severity
- review_liquidation_blacklist (liquidation) — sybil ring blacklist set
- review_rate_adjustment (rate_optimizer) — baseRate direction

Groq never signs transactions.

---

## 3. Credit Scoring System

Product core: multi-protocol financial picture + optional bank capacity → score trusted by borrow gates, SBT, and agents.

Entry: POST /score in ml/scoring_api.py → _score_sync()

Pipeline summary:
- Phase A (parallel): indexer/collect_sources.py — Aave, Morpho, CredFlow hub/spoke, Alchemy wallet features, Robinhood pipeline
- Phase B (parallel): XGBoost default prob + R-GCN sybil check
- Optional Reclaim: bank zkTLS → compute_on_chain_cred_score
- Approval: on_chain_cred_score >= 500 AND sybil_risk != "high"
- Outputs: cred_score, ml_cred_score, on_chain_cred_score, sub-scores, SHAP CID, sybil verdict
- Frontend: frontend/src/app/api/score/route.ts → triggerSyncScore()

Env: ALCHEMY_API_KEY, USE_MOCK_DATA=1 for offline dev.

### Alchemy Wallet Data (indexer/alchemy_pipeline.py)

tx_count, wallet_first_seen/last_active, recent_transactions (sybil graph), eth_balance_wei, unique_contracts_interacted.

### Multi-Protocol Indexer

Orchestrator: indexer/collect_sources.py
Pipelines: robinhood_pipeline (46630), spoke_pipeline (Aave Arb+Base), morpho_pipeline (Base), spoke_credflow_pipeline, scoring_metrics.
Prep Wallet tab: frontend/src/lib/prep-wallet-server.ts seeds on-chain history via Hardhat scripts.

### Reclaim Protocol (zkTLS Bank Balance)

Files: ml/reclaim_service.py, ml/score_engine.py, scripts/reclaim_helper.js, contracts/CredScoreEngine.sol

User proves bank balance via Reclaim portal (zkTLS). CredFlow gets balance_usd_cents + proof_hash only — no credentials stored.

Session flow: create session → user opens portal → POST /receive-proof callback → resume POST /score with session_id. Sessions in-memory, 15-min TTL. ngrok auto-configured by npm run ml:serve.

Balance → capacity factor (bps): ≥$5k=9200, ≥$1k=9600, ≥$100=9800, <$100=10000
Formula mirrors CredScoreEngine on-chain.

Underwriter calls CredScoreEngine.mintScore(..., reclaimProofHash, ...) when Reclaim enabled.

Env: RECLAIM_ENABLED=1, RECLAIM_APP_ID, RECLAIM_APP_SECRET, RECLAIM_PROVIDER_ID, RECLAIM_CALLBACK_URL. USE_MOCK_RECLAIM=1 for offline.

INR balances converted via exchangerate.host (1h cache); fallback INR_PER_USD env (default 86).

### XGBoost Model

Train: npm run ml:train → scripts/train_ml.py
Artifacts: ml/credflow_model.pkl, ml/credflow_explainer.pkl

default_prob = model.predict_proba(features)[1]
cred_score = 300 + (1 - default_prob) * 550

SHAP → Pinata IPFS → CID on SBT. Sub-scores: borrow_sub_score, wallet_sub_score (ml/sub_scores.py).

### All 37 Model Features (Summary)

Source: ml/constants.py FEATURE_COLUMNS, ml/feature_engineering.py

- Wallet-level (7): wallet_age_days, tx_count, unique_contracts_interacted, active_months_last_6, days_since_last_active, longest_inactive_gap_days, eth_balance — from Alchemy
- CredFlow hub (3): credflow_borrow/repay/liquidation counts — Robinhood pipeline
- Aave V3 (5): supply, withdraw, borrow, repay, liquidation counts — Arb + Base
- Morpho Blue (4): supply, withdraw, borrow, repay — Base
- Cross-protocol derived (12): total_borrow/repay counts, repay_ratio (primary predictor), avg_blocks_to_repay, avg_loan_duration_days, collateral patterns, diversity flags, partial repay metrics, multi_protocol_borrow_flag
- Red-flag booleans (6): has_been_liquidated, wallet_age_flag (<7 days), zero_repays_multiple_borrows_flag, burst_activity_flag, aave_only_wallet_flag, borrow_then_transfer_out_flag

### R-GCN Sybil Detection

Files: ml/sybil_detector.py, ml/sybil_model.pt, ml/on_chain_blacklist.py
Train: npm run ml:sybil-train

Graph from Alchemy transfers + blacklist seeds. Hard reject if defaulter_links > 0. R-GCN inference or heuristic fallback. Organic floor for small honest wallets. sybil_risk high = hard reject regardless of score.

At default: ml/graph_analysis.py identifies linked wallets for blacklist.

### Underwriter and SBT Mint

After scoring in UI (YourAccountTab → Build Score → Complete), underwriter commits on-chain separately from ML API.

SBT is soulbound on hub. Spokes read mirrored state via CredFlowOApp + LayerZero.

### Interest Rate and Tier Summary

Score range 300–850. Approval ≥ 500. Borderline Groq 480–520. Default LZ spoke score 310.

Max LTV by score: 500→40%, 580→50%, 620→60%, 680→65%, 720→75%, 750→85%
Health warning LTV: 75%. Liquidation LTV: 85%. Liquidation penalty: 5%. Grace period: 48h (agent in-memory).

Interest: borrowedAmount * interestRate * elapsedSeconds / (365 days * 10000)

---

## 4. Borrowing Logic

Loans tab → PurchaseLoanPanel → POST /api/loans/borrow. Server wallet signs via frontend/src/lib/loan-server.ts.

Display score from Supabase (same as dashboard); eligibility from on-chain registry per chain.

Before borrow: read score, blacklist, active loan on Robinhood + Arbitrum + Base. Hub loan locks other chains via LayerZero until repaid.

Collateral: collateralValueUSD = borrowAmount * 10000 / maxLTV; collateralWei from ETH/USD oracle.

Hub oracle: ChainlinkOracle + MockChainlinkFeed. Spokes: ChainlinkMirrorFeed (mainnet ETH/USD mirrored).

### Hub vs Spoke Borrow

Shared: WETH.deposit, approve, requestLoan(borrowAmount, weth, collateral, durationDays).

Hub CredFlowLending: requires SBT profile, checks loanActive/defaultCount, borrows USDG, setLoanActive on SBT, triggers crosschain_sync.

Spoke CredFlowSpokeLending: reads CredFlowOApp getScore/isLoanActive/isBlacklisted, borrows USDC, no SBT mutation, no agent on borrow.

### Post-Borrow LayerZero Sync (Hub Only)

triggerSyncLoanCreated → POST /agents/sync-loan event=created → sync_wallet_loan_active:
verify hub loan → read SBT score → broadcastScore + broadcastLoanActive to 40231 and 40245 → pay LZ fees → log tx hashes.

Spoke _lzReceive sets loanActiveMirror=true → spoke borrow blocked until MSG_REPAID.

Underwriter does NOT run on borrow.

---

## 5. Repayment Logic

RepayLoanPanel → POST /api/loans/repay → repayLoan() → runPostRepayPipeline().

On-chain repay: verify borrower/active → interest + principal → return WETH collateral → loan inactive → hub: setLoanRepaid on SBT → recordRepayment → LoanRepaid event.

### Post-Repay Pipeline (Hub)

1. Rescore (POST /score, floor_cred_score prevents score drop punishment)
2. Underwriter rescore=true → updateScore on SBT
3. crosschain_sync → broadcastScore + broadcastRepaid to both spokes
4. Fallback: triggerClearSpokeLoanActive if combined sync fails

### LayerZero Unlock

MSG_REPAID sets loanActiveMirror=false on spokes. If LZ lags: repaid-only broadcast fallback, POST /api/loans/clear-lz-lock for manual recovery.

---

## 6. Scenario: Price Goes Down

portfolio_monitor every 300s on all chains. ETH drop → LTV rises → Groq escalation → health warning at 75% LTV → liquidation at 85% LTV.

LTV_bps = (borrowedAmount + interest) * 10000 / collateralValueUSD

Liquidation agent: liquidate → graph analysis → blacklistLinkedWallets → broadcastDefault (MSG_DEFAULT) → spoke defaultBlacklist=true, spokeScores=310.

Borrower cannot borrow again (defaultCount > 0 on hub, blacklisted on spokes).

---

## 7. Scenario: Default and Overdue Loans

Contracts store dueTime but do NOT enforce it in liquidate/repay. Agents enforce calendar default.

Overdue flow: portfolio_monitor detects dueTime passed → start_grace 48h (agents/state.py, in-memory) → if no repay after 48h → liquidation_agent force_grace=True → ensure_liquidatable (testnet oracle crash) → liquidate → graph + blacklist → broadcastDefault.

During grace borrower can still repayLoan() → normal post-repay pipeline clears grace.

---

## 8. LayerZero Cross-Chain Messaging

CredScore issued once on Robinhood (SBT + underwriter), mirrored to Arbitrum/Base via LayerZero. One identity, synchronized state.

Why: prevents stale/fabricated spoke scores and double-borrows across chains.

Robinhood EID 40451 (official LZ V2). Peers: Arbitrum 40231, Base 40245.

### Message Types

- MSG_SCORE_UPDATE (1) → spokeScores[wallet] = score
- MSG_LOAN_ACTIVE (2) → loanActiveMirror[wallet] = true
- MSG_DEFAULT (3) → defaultBlacklist=true, spokeScores=310, loanActiveMirror=false
- MSG_REPAID (4) → loanActiveMirror=false

Spoke lending checks getScore, isBlacklisted, isLoanActive before USDC borrow.

Direction: Robinhood → Arbitrum/Base only. Credit mutations at SBT; other chains are synchronized replicas.

### Crosschain Sync Agent as Broadcaster

Only AGENT_PRIVATE_KEY with AGENT_ROLE calls hub CredFlowOApp broadcasts.
Files: agents/crosschain_sync.py, agents/sync_service.py, agents/base.py, frontend/src/lib/agent-client.ts

Per-spoke: one EID per tx (four txs for full hub-borrow sync).

Liquidation calls hub.broadcast_default directly per wallet.

### Options, Fees, Peers

Non-empty LZ options required (200k gas default).
Fee quoting: scripts/lz-quote-sync.js, lz-quote-debug.js
Peer setup: npm run lz:set-peers (hub), scripts/set-peer-spoke.js (spokes), npm run lz:status

Robinhood DVNs: LayerZero Labs, Nethermind, Horizen, Paxos (layerzero/config.json)

### Delivery Latency and Stale Locks

LZ is async. UI lock kinds: none, hub_mirror (hub loan blocks all spokes), lz_clear_pending (repaid but spoke mirror lagging).

Fallback: triggerClearSpokeLoanActive, POST /api/loans/clear-lz-lock

Manual scripts: scripts/lz-broadcast-score.js, lz-broadcast-loan-active.js

### Source of Truth

Authoritative: CredScoreSBT on hub (score, loanActive, blacklist)
Spoke copies: CredFlowOApp mappings via LZ messages
If LZ diverges: UI uses hub loan as hard lock (hub_mirror)

Lifecycle LZ triggers summary:
- Score/mint/rescore → MSG_SCORE_UPDATE
- Hub borrow → MSG_SCORE_UPDATE + MSG_LOAN_ACTIVE
- Spoke borrow → no LZ
- Hub repay → MSG_SCORE_UPDATE + MSG_REPAID
- Liquidation → MSG_DEFAULT per defaulter + linked wallets

---

## 9. Contracts Overview (Summary)

- CredScoreSBT.sol — soulbound credit profile on hub; score, sub-scores, loan state, SHAP CID, blacklist
- CredScoreEngine.sol — ML default prob + Reclaim balance on-chain formula → mint/update SBT
- CredFlowLending.sol — hub USDG lending; requestLoan, repayLoan, liquidate, emitHealthWarning, LTV/rate tiers
- CredFlowSpokeLending.sol — USDC lending; reads CredFlowOApp as credit registry; rejects if cross-chain loan active
- CredFlowLP.sol — liquidity pool; utilization for rate optimizer
- CredFlowOApp.sol — LZ OApp; hub broadcasts, spokes receive and mirror (ICredFlowCreditRegistry)
- ChainlinkOracle.sol — hub WETH/USD pricing
- ChainlinkMirrorFeed.sol — spoke mainnet ETH/USD mirror (scripts/sync-spoke-oracle.js)
- ICredFlowCreditRegistry.sol — getScore, isBlacklisted, isLoanActive interface for spoke lending

---

## 10. Agent-Contract Interaction Matrix (Summary)

Write access:
- underwriter → CredScoreEngine.mintScore, CredScoreSBT mintSBT/updateScore (mint/rescore)
- crosschain_sync → hub CredFlowOApp broadcastScore/LoanActive/Repaid/Default (LZ)
- portfolio_monitor → read LTV/loans; emitHealthWarning at 75% LTV
- liquidation_agent → liquidate; blacklistLinkedWallets; broadcastDefault via hub
- rate_optimizer → read CredFlowLP; setBaseRate on lending

User-signed (no agent): spoke requestLoan/repayLoan; hub requestLoan/repayLoan (borrow triggers sync agent after tx).

Contract-to-contract: CredFlowLending ↔ CredScoreSBT (setLoanActive/Repaid); Engine → SBT on mint.

---

## 11. Conclusion

CredFlow is credit depth + automation:
- 37-feature XGBoost + R-GCN sybil + optional Reclaim bank proof
- Portable CredScore SBT on Robinhood testnet
- Undercollateralized loans on Robinhood (USDG), Arbitrum (USDC), Base (USDC)
- Five agents: underwrite, sync, monitor, liquidate, optimize rates
- LayerZero V2 keeps all markets aligned on one underwritten identity

Live on testnet. Production hardening: calendar-overdue in contracts, persistent grace state, mainnet oracles, wallet-connect UX alongside demo server wallet.

---

## Key Environment Variables (Reference)

- FRONTEND_PRIVATE_KEY — server wallet (frontend/.env.local)
- AGENT_PRIVATE_KEY — all five agents + LZ broadcasts
- ALCHEMY_API_KEY — wallet indexing
- RECLAIM_ENABLED, RECLAIM_APP_ID, RECLAIM_APP_SECRET, RECLAIM_PROVIDER_ID, RECLAIM_CALLBACK_URL
- USE_MOCK_DATA=1, USE_MOCK_RECLAIM=1 — offline dev
- AGENT_MONITOR_INTERVAL_SEC — default 300
- LIQUIDATION_GRACE_HOURS — default 48
- GRAPH_ANALYSIS_MAX_WALLETS / LIQUIDATION_MAX_LINKED_WALLETS — sybil graph caps

---

## Key npm Scripts (Reference)

- npm run ml:serve — ML API + ngrok for Reclaim callbacks
- npm run ml:train — train XGBoost model
- npm run ml:sybil-train — train R-GCN sybil model
- npm run agents:serve — agent scheduler
- npm run lz:set-peers — wire LayerZero peers
- npm run lz:status — verify LZ pathway

---

*CredFlow — deep credit intelligence and autonomous agents for the next era of on-chain lending.*

*This is a temporary plain-text export. Delete when no longer needed.*
