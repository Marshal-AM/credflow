/**
 * Reclaim Protocol - Bank Balance Verifier (local dev helper)
 *
 * Prefer the integrated scoring API when available:
 *   RECLAIM_ENABLED=1 npm run ml:serve
 *   POST /score { "wallet_address": "0x...", "require_reclaim": true }
 *
 * This script is optional for standalone Reclaim testing.
 * Set credentials in .env (see .env.example) — never commit secrets.
 */

require("dotenv").config();
const express = require("express");
const qr = require("qrcode-terminal");
const ngrok = require("@ngrok/ngrok");
const { ReclaimProofRequest, verifyProof } = require("@reclaimprotocol/js-sdk");

const APP_ID = process.env.RECLAIM_APP_ID;
const APP_SECRET = process.env.RECLAIM_APP_SECRET;
const PROVIDER_ID = process.env.RECLAIM_PROVIDER_ID;
const NGROK_TOKEN = process.env.NGROK_TOKEN;
const PORT = parseInt(process.env.RECLAIM_DEV_PORT || "3000", 10);

if (!APP_ID || !APP_SECRET || !PROVIDER_ID) {
  console.error("Set RECLAIM_APP_ID, RECLAIM_APP_SECRET, RECLAIM_PROVIDER_ID in .env");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.text({ type: "*/*", limit: "50mb" }));

app.get("/start", async (req, res) => {
  try {
    const reclaimRequest = await ReclaimProofRequest.init(APP_ID, APP_SECRET, PROVIDER_ID);
    reclaimRequest.setAppCallbackUrl(`${app.locals.ngrokUrl}/receive-proof`);
    const requestUrl = await reclaimRequest.getRequestUrl();
    console.log("\nReclaim URL:", requestUrl, "\n");
    qr.generate(requestUrl, { small: true });
    res.json({ requestUrl, config: reclaimRequest.toJsonString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/receive-proof", async (req, res) => {
  try {
    const proof = JSON.parse(decodeURIComponent(req.body));
    const isValid = await verifyProof(proof);
    if (!isValid) return res.status(400).json({ error: "Invalid proof" });

    const proofItem = Array.isArray(proof) ? proof[0] : proof;
    const claimData = proofItem?.claimData || proofItem?.claim || proofItem;
    let extractedParams = {};
    try {
      extractedParams = JSON.parse(claimData.context).extractedParameters || {};
    } catch {
      extractedParams = claimData?.extractedParameters || {};
    }

    console.log("Verified balance data:", JSON.stringify(extractedParams, null, 2));
    console.log("\nForward this proof to POST /reclaim/callback on the scoring API.\n");
    res.sendStatus(200);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  if (!NGROK_TOKEN) {
    console.error("Set NGROK_TOKEN in .env for mobile Reclaim callbacks");
    process.exit(1);
  }
  const listener = await ngrok.forward({ addr: PORT, authtoken: NGROK_TOKEN });
  app.locals.ngrokUrl = listener.url();
  console.log(`Reclaim dev server http://localhost:${PORT}`);
  console.log(`ngrok: ${app.locals.ngrokUrl}`);
});
