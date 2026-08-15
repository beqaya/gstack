import type { RuntimeSignal, TimeWindow, Severity } from "../../types";

export interface LoggingClientOpts {
  projectId: string;
  /** Override for testing. In production this is constructed lazily from @google-cloud/logging. */
  client?: { getEntries(opts: { filter: string; pageSize?: number; orderBy?: string }): Promise<[unknown[], unknown?]> };
}

export interface LogFetchOpts {
  window: TimeWindow;
  logFilter: string;
  limit: number;
}

export interface LoggingClient {
  fetchLogs(opts: LogFetchOpts): Promise<RuntimeSignal[]>;
}

const SEVERITY_MAP: Record<string, Severity> = {
  EMERGENCY: "critical", ALERT: "critical", CRITICAL: "critical",
  ERROR: "high", WARNING: "medium", NOTICE: "low",
  INFO: "info", DEBUG: "info", DEFAULT: "info",
};

interface LogEntry {
  metadata?: {
    timestamp?: string;
    severity?: string;
    resource?: { labels?: Record<string, string> };
  };
  data?: unknown;
}

export function createLoggingClient(opts: LoggingClientOpts): LoggingClient {
  const client = opts.client ?? createRealClient(opts.projectId);
  return {
    async fetchLogs({ window, logFilter, limit }) {
      const filter = [
        logFilter,
        `timestamp >= "${window.start}"`,
        `timestamp <= "${window.end}"`,
      ].filter(Boolean).join(" AND ");
      const [entries] = await client.getEntries({ filter, pageSize: limit, orderBy: "timestamp desc" });
      return (entries as LogEntry[]).map(e => normalize(e, opts.projectId));
    },
  };
}

function normalize(entry: LogEntry, projectId: string): RuntimeSignal {
  const meta = entry.metadata ?? {};
  const labels = meta.resource?.labels ?? {};
  const sev = String(meta.severity ?? "DEFAULT").toUpperCase();
  return {
    type: "log",
    provider: "gcp",
    timestamp: meta.timestamp ?? new Date().toISOString(),
    severity: SEVERITY_MAP[sev] ?? "info",
    message: typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data ?? ""),
    region: labels.location,
    raw_link: `https://console.cloud.google.com/logs/query?project=${projectId}`,
    metadata: {
      service: labels.service_name,
      revision: labels.revision_name,
      ...labels,
    },
  };
}

function createRealClient(projectId: string): NonNullable<LoggingClientOpts["client"]> {
  // Lazy require so tests don't pull in the real SDK and installs without GCP can still load this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Logging } = require("@google-cloud/logging") as { Logging: new (o: { projectId: string }) => { getEntries(o: unknown): Promise<[unknown[]]> } };
  const logging = new Logging({ projectId });
  return {
    async getEntries(o) { return logging.getEntries(o); },
  };
}
