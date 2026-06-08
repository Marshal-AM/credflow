# CredFlow — Phase 2 Status

Last updated: June 2026

## Phase 2 — ML Pipeline

### Implemented

| Component | Location | Status |
|---|---|---|
| Dune pipeline | `indexer/dune_pipeline.py` | Multi-chain wallet + Aave across hub/spokes |
| Chain config | `indexer/chains.py` | Robinhood hub + Arbitrum/Base Sepolia spokes |
| Robinhood hub | `indexer/robinhood_pipeline.py` | CredFlow lending events + RPC wallet stats |
| Alchemy pipeline | `indexer/alchemy_pipeline.py` | `get_wallet_state`, webhook stub |
| GMX module | `indexer/gmx_module.py` | GMX v2 Subsquid GraphQL + `gmx_sub_score` |
| Sub-scores | `ml/sub_scores.py` | GMX/borrow/wallet scores from on-chain data (not SHAP) |
| Pinata IPFS | `ml/ipfs_pinata.py` | `PINATA_JWT` → real `ipfs://` CID for SHAP JSON |
| Mock data | `indexer/mock_data.py` | `USE_MOCK_DATA=1` fallbacks |
| Feature engineering | `ml/feature_engineering.py` | `build_feature_vector()` |
| Synthetic training data | `ml/generate_synthetic_data.py` | Threshold 0.82 (~12-15% default rate) |
| XGBoost training | `ml/train_model.py` | Train + `score_wallet()` + SHAP |
| Sybil detector | `ml/sybil_detector.py` | R-GCN + heuristic fallback |
| Scoring API | `ml/scoring_api.py` | `POST /score`, `GET /health` |

### npm scripts

```bash
npm run ml:train   # Generate synthetic CSV, train XGBoost + Sybil models
npm run ml:serve   # Start FastAPI on :8000
npm run ml:test    # Run Python pytest suite
```

### techGaps fixes applied

- Separate `fetch_aave_features` vs `fetch_wallet_features` in scoring API
- Synthetic default threshold `> 0.82` (not 0.7)
- Sybil detector: no unused torch_geometric imports; `model.eval()` at inference
- Sub-scores derived from indexer data (`ml/sub_scores.py`), not SHAP grouping
- Pinata JSON pin for SHAP explanations (`PINATA_JWT`); pseudo-CID fallback when unset
- Dune live queries use `run_sql()` (not deprecated `QueryBase(query_sql=…)`)
- GMX default endpoint: `gmx.squids.live` GMX v2 synthetics GraphQL
- Multi-chain indexing: Robinhood hub + Arbitrum/Base Sepolia spokes; GMX on Arbitrum mainnet as cross-chain reputation

### Environment variables

| Variable | Purpose |
|---|---|
| `DUNE_API_KEY` | Live Dune queries |
| `ALCHEMY_API_KEY` | Live wallet state + transfers |
| `USE_MOCK_DATA=1` | Skip external APIs (tests/dev) |
| `PINATA_JWT` | Pin SHAP JSON to IPFS via Pinata |
| `GMX_SUBGRAPH` | GMX v2 Subsquid GraphQL endpoint |
| `SCORING_API_URL` | Used by Phase 3 Underwriter Agent |

### Model artifacts (gitignored)

- `ml/credflow_model.pkl`
- `ml/credflow_explainer.pkl`
- `ml/sybil_model.pt`
- `ml/data/training_synthetic.csv`

Run `npm run ml:train` before starting the API.

### Validation (June 2026)

| Check | Result |
|---|---|
| `npm run ml:train` | AUC ~0.97 on synthetic data |
| `npm run ml:test` | 12/12 Python tests passing |
| Live `POST /score` | Sub-scores from source data; Pinata CID when `PINATA_JWT` set |

### Out of scope (Phase 3+)

- Underwriter Agent (`agents/underwriter_agent.py`)
- Frontend ScoreDashboard / onboarding
- Fhenix removed — on-chain-only scoring (13 features)

## Next: Phase 3

Wire Underwriter Agent to `POST /score` and on-chain `mintSBT`.
