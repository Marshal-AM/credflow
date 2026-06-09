/**
 * Start CredFlow scoring API + ngrok (when Reclaim is enabled).
 *
 *   npm run ml:serve
 *
 * Sets RECLAIM_CALLBACK_URL automatically from the live ngrok URL.
 */
require("dotenv").config();
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PYTHON =
  process.platform === "win32"
    ? path.join(ROOT, "credflow-env", "Scripts", "python.exe")
    : path.join(ROOT, "credflow-env", "bin", "python");

const PORT = parseInt(process.env.SCORING_API_PORT || "8000", 10);

function reclaimEnabled() {
  const v = (process.env.RECLAIM_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function startNgrok() {
  const token = process.env.NGROK_TOKEN;
  if (!token) {
    throw new Error("RECLAIM_ENABLED=1 requires NGROK_TOKEN in .env");
  }
  const ngrok = require("@ngrok/ngrok");
  const listener = await ngrok.forward({ addr: PORT, authtoken: token });
  const publicUrl = listener.url().replace(/\/$/, "");
  // Same path as reclaim/balance.js (/receive-proof)
  const callbackUrl = `${publicUrl}/receive-proof`;
  fs.writeFileSync(path.join(ROOT, ".ngrok-url"), publicUrl);
  console.log("\n" + "=".repeat(60));
  console.log("ngrok tunnel ready");
  console.log("  Public:   ", publicUrl);
  console.log("  Callback: ", callbackUrl);
  console.log("  Test:      ", callbackUrl, "(GET in browser)");
  console.log("=".repeat(60) + "\n");
  return { listener, callbackUrl };
}

async function main() {
  const env = { ...process.env };
  let ngrokListener = null;

  if (reclaimEnabled()) {
    const { listener, callbackUrl } = await startNgrok();
    ngrokListener = listener;
    env.RECLAIM_CALLBACK_URL = callbackUrl;
  } else {
    console.log("RECLAIM_ENABLED=0 — starting API without ngrok\n");
  }

  if (!fs.existsSync(PYTHON)) {
    throw new Error(`Python not found at ${PYTHON} — create credflow-env first`);
  }

  const child = spawn(PYTHON, ["-m", "ml.scoring_api"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    if (ngrokListener) {
      try {
        await ngrokListener.close();
      } catch {
        /* ignore */
      }
    }
    process.exit(exitCode);
  };

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const exitCode = code != null ? code : signal ? 1 : 0;
    shutdown(exitCode);
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
