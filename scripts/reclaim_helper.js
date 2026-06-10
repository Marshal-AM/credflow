/**
 * CLI helper for Reclaim Protocol — used by ml/reclaim_service.py (subprocess).
 *
 *   node scripts/reclaim_helper.js create --callback-url https://...
 *   echo '<proof json>' | node scripts/reclaim_helper.js verify
 */

const { ReclaimProofRequest, verifyProof } = require("@reclaimprotocol/js-sdk");

function emitJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function createRequest() {
  const appId = process.env.RECLAIM_APP_ID;
  const appSecret = process.env.RECLAIM_APP_SECRET;
  const providerId = process.env.RECLAIM_PROVIDER_ID;
  const callbackIdx = process.argv.indexOf("--callback-url");
  const callbackUrl = callbackIdx >= 0 ? process.argv[callbackIdx + 1] : process.env.RECLAIM_CALLBACK_URL;

  if (!appId || !appSecret || !providerId) {
    throw new Error("RECLAIM_APP_ID, RECLAIM_APP_SECRET, RECLAIM_PROVIDER_ID required");
  }
  if (!callbackUrl) {
    throw new Error("--callback-url or RECLAIM_CALLBACK_URL required");
  }

  // Match reclaim/balance.js exactly — plain init + default form-urlencoded callback
  const reclaimRequest = await ReclaimProofRequest.init(appId, appSecret, providerId);
  reclaimRequest.setAppCallbackUrl(callbackUrl);
  const config = reclaimRequest.toJsonString();
  const requestUrl = await reclaimRequest.getRequestUrl();
  const statusUrl = typeof reclaimRequest.getStatusUrl === "function" ? reclaimRequest.getStatusUrl() : null;
  emitJson({ requestUrl, statusUrl, config });
}

function extractParamsFromProof(proof) {
  const proofItem = Array.isArray(proof) ? proof[0] : proof;
  const claimData = proofItem?.claimData || proofItem?.claim || proofItem;
  try {
    const context = JSON.parse(claimData.context);
    return context.extractedParameters || {};
  } catch {
    return claimData?.extractedParameters || {};
  }
}

function normalizeVerifyResult(result) {
  if (typeof result === "boolean") {
    return { isVerified: result, error: null, data: null };
  }
  return {
    isVerified: Boolean(result?.isVerified),
    error: result?.error ?? null,
    data: result?.data ?? null,
  };
}

function parseProofBody(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty callback body");

  // Same as reclaim/balance.js: decodeURIComponent then JSON.parse
  const attempts = [
    () => JSON.parse(decodeURIComponent(text)),
    () => JSON.parse(text),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      /* try next */
    }
  }

  // application/x-www-form-urlencoded
  for (const part of text.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const value = part.slice(eq + 1);
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch {
      try {
        return JSON.parse(value);
      } catch {
        /* continue */
      }
    }
  }

  throw new Error("Cannot parse Reclaim proof from callback body");
}

async function verify() {
  const raw = await readStdin();
  const proof = parseProofBody(raw);

  // SDK v5 requires config — plain verifyProof(proof) always fails.
  // Portal bank proofs: skip HTTP hash checks; do NOT enable teeAttestation
  // (context has attestationNonce but not a full TEE JWT — TEE verify fails).
  const result = normalizeVerifyResult(
    await verifyProof(proof, { dangerouslyDisableContentValidation: true })
  );

  if (!result.isVerified) {
    const message =
      result.error?.message || (result.error ? String(result.error) : "Invalid proof");
    emitJson({ valid: false, error: message });
    return;
  }

  const extractedParams =
    result.data?.[0]?.extractedParameters || extractParamsFromProof(proof);

  emitJson({
    valid: true,
    extractedParameters: extractedParams,
  });
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === "create") {
      await createRequest();
    } else if (cmd === "verify") {
      await verify();
    } else {
      throw new Error("Usage: reclaim_helper.js create|verify");
    }
  } catch (err) {
    process.stderr.write(err.message || String(err));
    process.exit(1);
  }
}

main();
