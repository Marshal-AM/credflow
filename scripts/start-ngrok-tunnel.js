/**
 * Expose scoring API (port 8000) via ngrok — keeps running until Ctrl+C.
 * Writes public base URL to .ngrok-url on start.
 *
 *   npm run ngrok:serve
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const ngrok = require("@ngrok/ngrok");

const port = parseInt(process.env.SCORING_API_PORT || "8000", 10);
const token = process.env.NGROK_TOKEN;

if (!token) {
  console.error("NGROK_TOKEN required in .env");
  process.exit(1);
}

(async () => {
  const listener = await ngrok.forward({ addr: port, authtoken: token });
  const url = listener.url();
  const out = path.join(__dirname, "..", ".ngrok-url");
  fs.writeFileSync(out, url);
  console.log("\n" + "=".repeat(60));
  console.log("ngrok tunnel ACTIVE — leave this terminal open");
  console.log("Public URL:  ", url);
  console.log("Callback path:  " + url + "/receive-proof");
  console.log("(npm run ml:serve sets RECLAIM_CALLBACK_URL automatically)");
  console.log("Test:          curl " + url + "/receive-proof");
  console.log("=".repeat(60) + "\n");

  const shutdown = async () => {
    console.log("\nClosing ngrok tunnel...");
    await listener.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Keep process alive — tunnel dies if Node exits
  await new Promise(() => {});
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
