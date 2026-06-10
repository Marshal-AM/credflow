"use client";

type LogLine = {
  id: string;
  run_id: string;
  logged_at: string;
  level: string;
  message: string;
  agent_id?: string;
};

type AgentRun = {
  id: string;
  agent_id: string;
};

type Props = {
  logs: LogLine[];
  runs: AgentRun[];
  filterAgentId: string | null;
};

export function AgentLogPanel({ logs, runs, filterAgentId }: Props) {
  const runAgent = new Map(runs.map((r) => [r.id, r.agent_id]));
  const filtered = filterAgentId
    ? logs.filter(
        (l) =>
          l.agent_id === filterAgentId || runAgent.get(l.run_id) === filterAgentId
      )
    : logs;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">
          Live log {filterAgentId ? `(${filterAgentId})` : "(all agents)"}
        </h3>
      </div>
      <div className="max-h-80 overflow-y-auto p-4 font-mono text-xs">
        {!filtered.length ? (
          <p className="text-zinc-500">No log lines yet — run score, borrow, or trigger an agent.</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((line) => {
              const agent = line.agent_id || runAgent.get(line.run_id) || "?";
              const t = new Date(line.logged_at).toLocaleTimeString();
              return (
                <li key={line.id} className="text-zinc-700 dark:text-zinc-300">
                  <span className="text-zinc-400">{t}</span>{" "}
                  <span className="text-emerald-600">[{agent}]</span>{" "}
                  <span
                    className={
                      line.level === "error"
                        ? "text-red-600"
                        : line.level === "warn"
                          ? "text-amber-600"
                          : ""
                    }
                  >
                    {line.message}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
