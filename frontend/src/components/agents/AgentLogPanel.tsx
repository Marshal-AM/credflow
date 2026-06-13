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
    <div className="card-shell overflow-hidden">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-[650]">
          Live log {filterAgentId ? `(${filterAgentId})` : "(all agents)"}
        </h3>
      </div>
      <div className="max-h-80 overflow-y-auto p-4 font-mono text-xs">
        {!filtered.length ? (
          <p className="text-muted-foreground">
            No log lines yet — run score, borrow, or trigger an agent.
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((line) => {
              const agent = line.agent_id || runAgent.get(line.run_id) || "?";
              const t = new Date(line.logged_at).toLocaleTimeString();
              return (
                <li key={line.id} className="text-foreground/80">
                  <span className="text-subtle">{t}</span>{" "}
                  <span className="text-primary">[{agent}]</span>{" "}
                  <span
                    className={
                      line.level === "error"
                        ? "text-red-400"
                        : line.level === "warn"
                          ? "text-amber-400"
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
