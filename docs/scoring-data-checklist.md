# CredFlow Scoring — Data Source Checklist (testnet only)

Track which pipelines return **non-zero / real data** for your test wallet.

---

## Test wallet

| Field | Value |
|---|---|
| **Wallet** | `0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844` |
| **Hub** | Robinhood testnet — chain `46630` |
| **Spokes** | Arbitrum Sepolia `421614`, Base Sepolia `84532` |

### Refresh

```powershell
.\credflow-env\Scripts\python.exe scripts\live_integration_test.py
Invoke-RestMethod -Method POST -Uri "http://localhost:8000/score" -ContentType "application/json" -Body '{"wallet_address":"0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844"}'
```

---

## Data sources

| Status | Source | Module | ML features |
|:---:|---|---|---|
| ☐ | **CredFlow lending** | `robinhood_pipeline.py` | `total_borrows`, `repayment_rate`, `defi_liquidation_count`, `avg_loan_duration_days` |
| ☐ | **Robinhood wallet RPC** | `robinhood_pipeline.py` | `tx_count`, `protocol_diversity`, `wallet_age_days` |
| ☐ | **Spoke wallet RPC** | `spoke_pipeline.py` + Alchemy | `tx_count`, `protocol_diversity`, `wallet_age_days` |
| ☐ | **Base Sepolia Aave** | `spoke_pipeline.py` (aavefetch approach) | borrow features |
| ☐ | **Alchemy / RPC balances** | `alchemy_pipeline.py` | `eth_balance`, sybil graph |
| ☐ | **Pinata IPFS** | `ml/ipfs_pinata.py` | SBT metadata (`shap_cid`) |

---

## 8 ML features

| Feature | Fed by |
|---|---|
| `wallet_age_days` | Earliest `wallet_first_seen` across hub + spoke RPC |
| `tx_count` | Alchemy/RPC aggregate |
| `protocol_diversity` | Unique protocols from RPC wallet rows |
| `total_borrows` | CredFlow hub + Base Sepolia Aave |
| `repayment_rate` | `on_time_repayments / total_borrows` |
| `defi_liquidation_count` | Borrow sources |
| `avg_loan_duration_days` | Borrow sources |
| `eth_balance` | Sum of native balances across chains |

---

## Environment

| Variable | Required for |
|---|---|
| `USE_MOCK_DATA=0` | Live data |
| `RPC_ROBINHOOD` | Hub lending + wallet |
| `CREDFLOW_LENDING_ADDRESS` | Hub borrow events |
| `ALCHEMY_API_KEY` | Spoke transfers, Aave fetch, token balances |
| `PINATA_API_KEY` + `PINATA_SECRET_KEY` | Real `shap_cid` |
