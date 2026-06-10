import fs from "fs";
import path from "path";

export type FileAgentRun = {
  id: string;
  agent_id: string;
  status: string;
  trigger_source: string;
  trigger_event: string | null;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  wallet_address?: string | null;
  kind?: string;
};

export type FileLogLine = {
  id: string;
  run_id: string;
  logged_at: string;
  level: string;
  message: string;
  agent_id: string;
};

type RunFile = {
  run_id?: string;
  kind?: string;
  agent_id?: string;
  wallet_address?: string;
  trigger_source?: string;
  trigger_event?: string;
  hook?: string;
  started_at?: string;
  finished_at?: string;
  status?: string;
  summary?: string;
  logs?: Array<{ at?: string; level?: string; message?: string }>;
};

function getLogRoot(): string {
  if (process.env.AGENT_RUN_LOG_DIR) {
    return process.env.AGENT_RUN_LOG_DIR;
  }
  const cwd = process.cwd();
  return cwd.endsWith("frontend") || cwd.includes(`${path.sep}frontend`)
    ? path.join(cwd, "..", "logs", "agent-runs")
    : path.join(cwd, "logs", "agent-runs");
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

function latestSessionDir(): string | null {
  const sessionsRoot = path.join(getLogRoot(), "sessions");
  if (!fs.existsSync(sessionsRoot)) return null;
  const dirs = fs
    .readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(sessionsRoot, d.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

function sessionDirs(): string[] {
  const active = getActiveSessionDir();
  const latest = latestSessionDir();
  const dirs: string[] = [];
  if (active) dirs.push(active);
  if (latest && latest !== active) dirs.push(latest);
  if (!dirs.length) {
    const fallback = path.join(getLogRoot(), "no-session");
    if (fs.existsSync(fallback)) dirs.push(fallback);
  }
  return dirs;
}

function agentIdForRun(file: RunFile): string {
  if (file.agent_id) return file.agent_id;
  if (file.kind === "score") return "scoring_api";
  if (file.kind === "api_hook") return `api_hook:${file.hook || "unknown"}`;
  return "unknown";
}

function readRunFile(filePath: string): RunFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as RunFile;
  } catch {
    return null;
  }
}

function listRunFiles(sessionDir: string, subdir: string): string[] {
  const dir = path.join(sessionDir, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

export function loadAgentRunsFromFiles(options?: {
  wallet?: string;
  agentId?: string;
  runLimit?: number;
  logLimit?: number;
}): { runs: FileAgentRun[]; logs: FileLogLine[]; sessionDir: string | null } {
  const runLimit = options?.runLimit ?? 50;
  const logLimit = options?.logLimit ?? 200;
  const wallet = options?.wallet?.toLowerCase();
  const agentFilter = options?.agentId;

  const dirs = sessionDirs();
  const sessionDir = dirs[0] ?? null;
  const collected: Array<{ file: RunFile; mtime: number }> = [];

  for (const dir of dirs) {
    for (const sub of ["agent-runs", "score-runs", "api-hooks"] as const) {
      for (const filePath of listRunFiles(dir, sub)) {
        const file = readRunFile(filePath);
        if (!file?.run_id) continue;
        if (wallet && file.wallet_address && file.wallet_address.toLowerCase() !== wallet) {
          continue;
        }
        const agent_id = agentIdForRun(file);
        if (agentFilter && agent_id !== agentFilter && file.agent_id !== agentFilter) {
          continue;
        }
        collected.push({ file, mtime: fs.statSync(filePath).mtimeMs });
      }
    }
  }

  collected.sort((a, b) => {
    const ta = Date.parse(a.file.started_at || "") || a.mtime;
    const tb = Date.parse(b.file.started_at || "") || b.mtime;
    return tb - ta;
  });

  const runs: FileAgentRun[] = collected.slice(0, runLimit).map(({ file }) => ({
    id: file.run_id!,
    agent_id: agentIdForRun(file),
    status: file.status || "unknown",
    trigger_source: file.trigger_source || file.kind || "file",
    trigger_event: file.trigger_event ?? file.hook ?? null,
    started_at: file.started_at || new Date(0).toISOString(),
    finished_at: file.finished_at ?? null,
    summary: file.summary ?? null,
    wallet_address: file.wallet_address ?? null,
    kind: file.kind,
  }));

  const logs: FileLogLine[] = [];
  for (const { file } of collected.slice(0, 15)) {
    const agent_id = agentIdForRun(file);
    const entries = file.logs || [];
    entries.forEach((entry, index) => {
      logs.push({
        id: `${file.run_id}-${index}`,
        run_id: file.run_id!,
        logged_at: entry.at || file.started_at || new Date().toISOString(),
        level: entry.level || "info",
        message: entry.message || "",
        agent_id,
      });
    });
  }

  logs.sort((a, b) => Date.parse(b.logged_at) - Date.parse(a.logged_at));

  return { runs, logs: logs.slice(0, logLimit), sessionDir };
}
