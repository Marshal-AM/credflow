# Postman: Reclaim + full scoring flow

## Prerequisites

1. **Start everything** (API + ngrok when `RECLAIM_ENABLED=1`):
   ```bash
   npm run ml:serve
   ```
   Logs print the live `RECLAIM_CALLBACK_URL` automatically. No separate ngrok command needed.

   Requires in `.env`:
   ```
   RECLAIM_ENABLED=1
   USE_MOCK_RECLAIM=0
   NGROK_TOKEN=...
   ```

3. **Import collection**: `docs/postman/CredFlow-Reclaim.postman_collection.json`

---

## Flow (3 Postman steps)

### Step 1 — Get Reclaim URL

**POST** `http://localhost:8000/score`

```json
{
  "wallet_address": "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844",
  "require_reclaim": true
}
```

**Response** (`status: awaiting_reclaim`):
- `reclaim_url` — open in your **PC browser** (portal mode, same as `reclaim/balance.js`)
- `reclaim_session_id` — save for step 3

**Server logs** print the URL in a banner:
```
============================================================
RECLAIM STEP 1 — open this URL in your browser (portal mode):
  https://portal.reclaimprotocol.org/...
============================================================
```

### Step 2 — Complete bank login on phone

1. Open `reclaim_url` on your phone
2. Log into IndusInd bank
3. Reclaim sends proof to your ngrok callback automatically

**Optional poll in Postman:**

**GET** `http://localhost:8000/reclaim/session/{reclaim_session_id}`

When `status` is `verified`, the response includes `next_step` with the exact body for step 3.

**Server logs** after callback:
```
============================================================
RECLAIM STEP 2 — bank proof verified
POST /score to run wallet analysis + ML scoring:
  {"wallet_address":"0x...","require_reclaim":true,"reclaim_session_id":"..."}
============================================================
```

### Step 3 — Full wallet analysis + ML score

**POST** `http://localhost:8000/score`

```json
{
  "wallet_address": "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844",
  "require_reclaim": true,
  "reclaim_session_id": "<from step 1>"
}
```

**Shortcut:** after callback, you can omit `reclaim_session_id` — the API auto-finds the verified session for that wallet:

```json
{
  "wallet_address": "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844",
  "require_reclaim": true
}
```

**Response** (`status: complete`):
- `cred_score` — on-chain preview (ML + balance capacity factor)
- `ml_cred_score` — XGBoost-only score
- `default_prob_bps`, `balance_usd_cents`, `reclaim` metadata
- `model_breakdown`, `shap_values`, sybil check, full indexer payload

### Step 4 — Mint on-chain (optional)

```bash
npm run agent:underwrite -- 0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844 --rescore
```

Calls `CredScoreEngine.mintScore()` on Robinhood testnet.

---

## Score without Reclaim

```json
{
  "wallet_address": "0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844",
  "require_reclaim": false
}
```
