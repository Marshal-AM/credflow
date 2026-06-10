import fs from "fs";
import path from "path";

type RunLogStep = {
  step: string;
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
};

function getLogRoot(): string {
  if (process.env.AGENT_RUN_LOG_DIR) {
    return process.env.AGENT_RUN_LOG_DIR;
  }
  const cwd = process.cwd();
  const base = cwd.endsWith("frontend") || cwd.includes(`${path.sep}frontend`)
    ? path.join(cwd, "..", "logs", "agent-runs")
    : path.join(cwd, "logs", "agent-runs");
  return base;
}

function getActiveSessionDir(): string | null {
  try {
    const pointer = path.join(getLogRoot(), "_current_session");
    if (!fs.existsSync(pointer)) return null;
    const raw = fs.readFileSync(pointer, "utf-8").trim();
    if (!raw || !fs.existsSync(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function runsDir(kind: "api-hooks" | "score-runs"): string {
  const session = getActiveSessionDir();
  const base = session ?? path.join(getLogRoot(), "no-session");
  const dir = path.join(base, kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 48);
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function writeApiHookRun(params: {
  hook: string;
  wallet: string;
  chainKey?: string;
  success: boolean;
  summary: string;
  steps?: RunLogStep[];
  payload?: Record<string, unknown>;
  error?: string;
}): string | null {
  try {
    const runId = crypto.randomUUID();
    const shortId = runId.replace(/-/g, "").slice(0, 8);
    const name = [
      utcStamp(),
      slug(params.hook),
      slug(params.chainKey ?? "all"),
      slug(params.wallet.slice(0, 12)),
      shortId,
    ].join("_");
    const filePath = path.join(runsDir("api-hooks"), `${name}.json`);
    const record = {
      run_id: runId,
      kind: "api_hook",
      hook: params.hook,
      wallet_address: params.wallet.toLowerCase(),
      chain_key: params.chainKey ?? null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: params.success ? "success" : "failed",
      summary: params.summary,
      steps: params.steps ?? [],
      payload: params.payload ?? null,
      error: params.error ?? null,
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
    return filePath;
  } catch {
    return null;
  }
}
