import type { RuntimeSignal, TimeWindow } from "../../types";

export interface ErrorsClientOpts {
  projectId: string;
  client?: { listGroupStats(opts: unknown): Promise<[unknown[], unknown?]> };
}

export interface ErrorsClient {
  fetchErrorGroups(opts: { window: TimeWindow; limit: number }): Promise<RuntimeSignal[]>;
}

interface GcpErrorGroup {
  group?: { groupId?: string };
  count?: string | number;
  firstSeenTime?: { seconds?: string | number };
  representative?: { message?: string };
  affectedServices?: { service?: string }[];
}

export function createErrorsClient(opts: ErrorsClientOpts): ErrorsClient {
  const client = opts.client ?? createRealClient();
  return {
    async fetchErrorGroups({ limit }) {
      const [stats] = await client.listGroupStats({
        projectName: `projects/${opts.projectId}`,
        timeRange: { period: "PERIOD_1_DAY" },
        pageSize: limit,
      });
      return (stats as GcpErrorGroup[]).map(g => normalize(g, opts.projectId));
    },
  };
}

function normalize(g: GcpErrorGroup, projectId: string): RuntimeSignal {
  const ts = g.firstSeenTime?.seconds
    ? new Date(Number(g.firstSeenTime.seconds) * 1000).toISOString()
    : new Date().toISOString();
  const count = Number(g.count ?? 0);
  return {
    type: "error",
    provider: "gcp",
    timestamp: ts,
    severity: count > 100 ? "high" : count > 10 ? "medium" : "low",
    message: g.representative?.message ?? "(no message)",
    count,
    raw_link: `https://console.cloud.google.com/errors/${g.group?.groupId}?project=${projectId}`,
    metadata: {
      group_id: g.group?.groupId,
      services: (g.affectedServices ?? []).map(s => s.service).filter(Boolean),
    },
  };
}

function createRealClient(): NonNullable<ErrorsClientOpts["client"]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { ErrorGroupServiceClient } = require("@google-cloud/error-reporting") as { ErrorGroupServiceClient: new () => { listGroupStats(o: unknown): Promise<[unknown[]]> } };
  const c = new ErrorGroupServiceClient();
  return {
    async listGroupStats(o) { return c.listGroupStats(o); },
  };
}
