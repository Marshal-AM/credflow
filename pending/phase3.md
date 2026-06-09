# CredFlow — Phase 3 Status (Groq Agents + Cross-Chain)

Last updated: June 2026

## Spoke deployment (Step 1)

| Chain | EID | OApp address |
|---|---|---|
| Arbitrum Sepolia | 40231 | `0x84515380cE0a9E057F4c4686E12d383BA5BBA28e` |
| Base Sepolia | 40245 | `0x1D0Ea904c9EA40Dd1319F8802e6b12D0EaA6Ca7f` |
| Robinhood hub | 40451 | `0x57061d08986D780f5755887207e355bf8f5813D8` |

Peers wired bidirectionally via `npm run lz:set-peers` + `set-peer-spoke.js`.

## Agents

| Agent | Module | CLI |
|---|---|---|
| Underwriter | `agents/underwriter_agent.py` | `npm run agent:underwrite -- <wallet>` |
| Portfolio Monitor | `agents/portfolio_monitor.py` | `npm run agent:monitor -- --once` |
| Liquidation | `agents/liquidation_agent.py` | `npm run agent:liquidate -- --loan-id N` |
| Cross-Chain Sync | `agents/crosschain_sync.py` | `npm run agent:sync -- --once` |
| Rate Optimizer | `agents/rate_optimizer.py` | `npm run agent:rates -- --once` |

Shared infra: `agents/base.py`, `agents/groq_brain.py`, `agents/lz_options.py`, `agents/state.py`.

## E2E test sequence

1. `npm run ml:serve`
2. `npm run grant:agent-roles` (rate optimizer admin)
3. `npm run agent:underwrite -- 0x2514...6844`
4. `npm run smoke:borrow`
5. `npm run agent:sync -- --once`
6. `npm run agent:monitor -- --once`
7. `npm run agent:rates -- --once`
8. `npm run simulate:default` then `npm run agent:liquidate -- --loan-id 1`
9. Verify hub `isBlacklisted` + spoke `defaultBlacklist` after LZ delivery
