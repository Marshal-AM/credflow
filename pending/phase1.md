# CredFlow — Phase 0 & Phase 1 Status

Last updated: June 2026  
Network: **Robinhood Chain Testnet** (chain ID `46630`)  
Deployer wallet: `0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844`

---

## Phase 0 — Environment Setup

### Implemented

| Item | Status | Location / notes |
|---|---|---|
| Monorepo directory layout | Done | `contracts/`, `scripts/`, `tests/`, `agents/`, `ml/`, `indexer/`, `layerzero/`, `fhenix/`, `frontend/`, `docs/` |
| Hardhat toolchain | Done | `hardhat.config.js`, `package.json` |
| Solidity compiler | Done | v0.8.22, optimizer on, viaIR |
| OpenZeppelin v4.9.x | Done | Matches spec `security/` import paths |
| LayerZero OApp v2 deps | Done | `@layerzerolabs/lz-evm-oapp-v2`, protocol + messagelib packages |
| Python requirements | Done | `requirements.txt` (agents/ML not built yet) |
| `.env.example` | Done | USDG, WETH, Robinhood RPC, all vars from `techGaps.md` |
| `.gitignore` | Done | `.env`, `node_modules/`, `artifacts/`, `credflow-env/`, etc. |
| `README.md` | Done | Setup, deploy, test, live addresses |
| Frontend scaffold | Done | Next.js + TypeScript + Tailwind in `frontend/` |
| Frontend Web3 deps | Done | wagmi, viem, `@rainbow-me/rainbowkit`, recharts, ethers, fhenixjs |
| Frontend wagmi config | Done | `frontend/src/lib/wagmi.ts` (Robinhood chain) |
| Deployed addresses in frontend | Done | `frontend/src/lib/addresses.json` |

### Phase 0 — Still pending

| Item | Why it matters | Action needed |
|---|---|---|
| `WS_ROBINHOOD` websocket URL | Real-time Alchemy webhooks (Phase 3+) | Create Alchemy app, add websocket URL to `.env` |
| `ALCHEMY_API_KEY` | GMX/wallet data pipelines (Phase 2+) | Register at [alchemy.com](https://www.alchemy.com/rpc/robinhood-testnet) |
| `DUNE_API_KEY` | ML training data (Phase 2+) | Register at dune.com |
| Python venv setup | Agents/ML not started | `python -m venv credflow-env` + `pip install -r requirements.txt` |
| Foundry (optional) | Spec mentions it; not required on Windows | Hardhat covers compile/test/deploy |
| Frontend UI (Phase 5) | Only scaffold exists | ScoreDashboard, LoanPanel, onboarding — deferred to Phase 5 |
| `fhenixjs` deprecation warning | Package marked unsupported on npm | Monitor Fhenix docs for replacement SDK before Phase 4 |

---

## Phase 1 — Smart Contracts

### Implemented contracts

| Contract | File | techGaps fixes applied |
|---|---|---|
| **CredScoreSBT** | `contracts/CredScoreSBT.sol` | ERC721 inheritance, `_safeMint` on profile creation, non-transferable SBT, UUPS upgradeable |
| **CredFlowLending** | `contracts/CredFlowLending.sol` | `borrowToken` (USDG), pool integration, `setLiquidationParams`, `setBaseRate`, `setLiquidityPool` |
| **CredFlowLP** | `contracts/CredFlowLP.sol` | `recordBorrow` / `recordRepayment`, `setLendingContract`, `utilizationRate` tracking |
| **CredFlowOApp** | `contracts/CredFlowOApp.sol` | LayerZero OApp, spoke-chain NatSpec comment in `_lzReceive` |
| **ChainlinkOracle** | `contracts/ChainlinkOracle.sol` | `setPriceFeed`, `getValueUSD` (6-decimal USD) |
| **MockPriceOracle** | `contracts/mocks/MockPriceOracle.sol` | Test-only oracle for isolated unit tests |
| **ILTVOracle** | `contracts/interfaces/ILTVOracle.sol` | Price interface |
| **ILiquidityPool** | `contracts/interfaces/ILiquidityPool.sol` | Pool borrow/repay tracking interface |

### Deployment scripts

| Script | Status | Purpose |
|---|---|---|
| `scripts/deploy.js` | Done + run on testnet | Deploy oracle → SBT → LP → lending → OApp; wire roles; fund lending with USDG; export ABIs |
| `scripts/deploy-spoke.js` | Done (not run) | Deploy OApp on Arbitrum/Base spokes (Phase 6) |
| `scripts/set-peers.js` | Done (not run) | Wire hub ↔ spoke LayerZero peers (Phase 6) |

### Tests

| Test file | Status | Coverage |
|---|---|---|
| `tests/CredScoreSBT.test.js` | **4/4 passing** | Mint, transfer block, default, duplicate reject |
| `tests/MockPriceOracle.test.js` | **1/1 passing** | USD valuation math |
| `tests/CredFlowLending.test.js` | **7/7 passing** | Maya LTV (scaled), LTV reject, no-profile reject, repay, tiers, liquidate |
| `tests/CredFlowLP.test.js` | **2/2 passing** | Utilization tracking, access control |
| `tests/helpers.js` | Done | Fork fixture, real USDG from deployer wallet, WETH wrap helper |

**Total: 14/14 tests passing**

Tests fork Robinhood testnet and use the deployer wallet (`DEPLOYER_PRIVATE_KEY` in `.env`) for real USDG. Borrow amounts are scaled to fit the ~100 USDG testnet balance (e.g. borrow 50 USDG, not 1800).

### Robinhood testnet tokens (official)

| Token | Address | Role |
|---|---|---|
| **USDG** | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | Borrow asset, pool deposits, repayments |
| **WETH** | `0x7943e237c7F95DA44E0301572D358911207852Fa` | Collateral (wrap native ETH first) |
| **Native ETH** | wallet balance | Gas + source for WETH wrapping |

No mock ERC-20 tokens are used in production or on testnet.

---

## Live testnet deployment

Deployed from `0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844` on Robinhood Chain testnet.

| Contract | Address |
|---|---|
| CredScoreSBT | `0x3EA6D1c84481f89aac255a7ABC375fe761653cdA` |
| CredFlowLending | `0x14d42947929F1ECf882aA6a07dd4279ADb49345d` |
| CredFlowLP | `0x1E491de1a08843079AAb4cFA516C717597344e50` |
| ChainlinkOracle | `0x26D215752f68bc2254186F9f6FF068b8C4BdFd37` |
| CredFlowOApp | `0x0866f40D55E96b2D74995203Caff032aD81c14B0` |
| MockChainlinkFeed (WETH/USD) | `0x6034FAcE419117Af850411CA58d83c1405F3398F` ($3000) |

Also saved in `docs/addresses.json` and `frontend/src/lib/addresses.json`.

ABIs exported to `docs/abis/`:
- `CredScoreSBT.json`
- `CredFlowLending.json`
- `CredFlowLP.json`
- `CredFlowOApp.json`
- `ChainlinkOracle.json`

### Role grants (deploy script)

| Role | Granted to |
|---|---|
| `SBT.SCORER_ROLE` | `AGENT_WALLET_ADDRESS` (`0x251…b6844`) |
| `SBT.AGENT_ROLE` | Agent wallet **and** lending contract address |
| `Lending.AGENT_ROLE` | Agent wallet |
| `OApp.AGENT_ROLE` | Agent wallet (when OApp is deployed) |

### Lending pool funding

- **50 USDG** transferred from deployer wallet → lending contract at deploy time
- `LENDING_FUND_USDG=50` in `.env`

---

## Phase 1 — Still pending (must fix before live borrows / Phase 2)

### Oracle: Mock vs Chainlink (important distinction)

| Environment | Oracle used | How WETH/USD price is set |
|---|---|---|
| **`npx hardhat test`** (local fork) | `MockPriceOracle` | Deployed fresh per test; `setPrice(WETH, $3000, 18)` in `tests/helpers.js` |
| **Live Robinhood testnet** | `ChainlinkOracle` at `0x26D215752f68bc2254186F9f6FF068b8C4BdFd37` | Lending contract points here — **not** the mock |

The mock is **test-only**. It is never deployed on testnet. Your live `CredFlowLending` (`0x14d429…9345d`) was wired to `ChainlinkOracle` at deploy time. Until a price is configured on that oracle, `requestLoan()` will revert (`No price feed`) because `getValueUSD(WETH, …)` has no feed.

**Two ways to unblock live testnet borrows:**

1. **Chainlink (production path):** Set `CHAINLINK_ETH_USD_FEED` in `.env`, then call `setPriceFeed(WETH_ROBINHOOD, feed, 18)` on the deployed oracle (you are the owner).
2. **Mock on testnet (dev shortcut):** Deploy `MockPriceOracle` on testnet, call `setPrice(WETH, 3000e6, 18)`, then **redeploy `CredFlowLending`** with the mock address as oracle (lending has no `setOracle` admin function today).

### Critical — completed

| Item | Status | Details |
|---|---|---|
| **WETH/USD price on live oracle** | **Done** | `MockChainlinkFeed` at `0x6034FAcE…398F` wired via `setPriceFeed` ($3000/ETH). Robinhood testnet uses Chainlink Data Streams, not legacy AggregatorV3 feeds — mock is the correct testnet path. |
| **Live borrow smoke test** | **Done** | 5 USDG borrowed against 0.005 WETH — tx `0x75592c4d43a1509c7bf3878475153986aa5428af3c4dedc1ad6cd198a152ca8f` |
| **CredFlowOApp deploy** | **Done** | Hub OApp `0x0866f40D55E96b2D74995203Caff032aD81c14B0` |

### LayerZero — hub deployed

Robinhood testnet is **officially supported** by LayerZero V2 (eid **40451**). No self-deployed endpoint needed — see `docs/layerzero.md` and `layerzero/config.json`.

| Item | Value |
|---|---|
| EndpointV2 | `0x3aCAAf60502791D199a5a5F0B173D78229eBFe32` |
| CredFlowOApp (hub) | `0x0866f40D55E96b2D74995203Caff032aD81c14B0` |
| Verify on-chain | `npm run lz:status` |

**Phase 6 (later):** Deploy spoke OApps on Arbitrum Sepolia + Base Sepolia (`deploy-spoke.js`), wire peers (`lz:set-peers` + `set-peer-spoke.js`), fund agent wallet with ETH on each chain for `broadcastScore` / `broadcastDefault` gas.

OApp is **not required** for Phase 2 (ML pipeline) or basic testnet borrowing. It is required for cross-chain score sync (Phase 6).

### Important (Phase 1 gaps carried into later phases)

| Item | Notes |
|---|---|
| Spoke deployment (Arbitrum Sepolia, Base Sepolia) | `deploy-spoke.js` + `set-peers.js` ready but not executed — Phase 6 |
| OApp cross-chain tests | Deferred — needs live LayerZero endpoints and funded agent wallet |
| `PRICE_ORACLE` env var | Not set; oracle address is in `docs/addresses.json` instead |
| More USDG in lending pool | Only 50 USDG funded; need more for larger test borrows |
| `recoverSigner` on CredScoreSBT | Mentioned in `techGaps.md` for Fhenix attestation verification — not implemented (Phase 4) |
| UUPS proxy deployment | Contract is UUPS-upgradeable but deployed directly (no proxy) — fine for testnet, revisit for mainnet |
| Rate Optimizer / governance wiring | `setBaseRate` exists on lending; no agent calls it yet (Phase 3) |

### Environment vars still empty in `.env`

```
CHAINLINK_ETH_USD_FEED=
PRICE_ORACLE=
WS_ROBINHOOD=
CHAINLINK_ETH_USD_FEED=
# LayerZero — set in .env (see layerzero/config.json)
# LAYERZERO_ENDPOINT_ROBINHOOD, LZ_EID_* configured
RPC_ARBITRUM_SEPOLIA=
RPC_BASE_SEPOLIA=
ALCHEMY_API_KEY=
DUNE_API_KEY=
NEXT_PUBLIC_FHENIX_CONTRACT=
FHENIX_RPC=
FHENIX_API_KEY=
OZ_DEFENDER_SECRET=
```

---

## How to run

```bash
# Compile
npx hardhat compile

# Tests (forks Robinhood, uses your wallet's USDG)
npx hardhat test

# Deploy to testnet
npx hardhat run scripts/deploy.js --network robinhoodTestnet

# LayerZero hub OApp + status
npm run lz:status
npm run deploy:oapp

# Wire oracle + live borrow smoke test
npm run oracle:wire
npm run smoke:borrow

# Frontend dev server (scaffold only)
cd frontend && npm run dev
```

---

## Phase 0 & 1 completion summary

| Phase | Core deliverable | Status |
|---|---|---|
| Phase 0 | Repo scaffold, tooling, env, frontend skeleton | **Complete** |
| Phase 1 | Contracts, tests, testnet deploy, ABIs | **Complete** |
| Phase 1 post-deploy | Oracle feed, live borrow smoke test | **Complete** |

**Ready to start Phase 2** (ML pipeline).

---

## Next recommended steps (in order)

1. Begin Phase 2: Dune pipeline → feature engineering → XGBoost training → scoring API
2. **Phase 6:** Deploy spoke OApps + wire peers for cross-chain score sync
3. Optional: top up lending pool with more USDG for larger test borrows
