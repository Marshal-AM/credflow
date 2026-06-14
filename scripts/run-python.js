#!/usr/bin/env node
/** Cross-platform wrapper for credflow-env Python (macOS/Linux + Windows). */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const candidates =
  process.platform === "win32"
    ? [path.join(ROOT, "credflow-env", "Scripts", "python.exe")]
    : [
        path.join(ROOT, "credflow-env", "bin", "python"),
        path.join(ROOT, "credflow-env", "bin", "python3"),
      ];

const python = candidates.find((p) => fs.existsSync(p));
if (!python) {
  console.error(
    "Python venv not found. Create it with:\n  python3 -m venv credflow-env\n  source credflow-env/bin/activate && pip install -r requirements.txt"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(python, args, { stdio: "inherit", cwd: ROOT, env: process.env });
process.exit(result.status ?? 1);
