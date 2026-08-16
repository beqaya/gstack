import type { RuntimeSignal, TimeWindow } from "../../types";

export interface ErrorsClientOpts {
  projectId: string;
  /** Bearer token for the REST fallback client (unused when `client` is injected). */
  authToken?: string | null;
  client?: { listGroupStats(opts: unknown): Promise<[unknown[], unknown?]> };
}

export interface ErrorsClient {
  fetchErrorGroups(opts: { window: TimeWindow; limit: number }): Promise<RuntimeSignal[]>;
}

interface GcpErrorGroup {
  group?: { groupId?: string };
  count?: string | number;
  /** gRPC shape is {seconds}; the REST API returns an RFC3339 string. */
  firstSeenTime?: { seconds?: string | number } | string;
  representative?: { message?: string };
  affectedServices?: { service?: string }[];
}

export function createErrorsClient(opts: ErrorsClientOpts): ErrorsClient {
  const client = opts.client ?? createRealClient(opts);
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
  const first = g.firstSeenTime;
  const ts = typeof first === "string"
    ? new Date(first).toISOString()
    : first?.seconds
      ? new Date(Number(first.seconds) * 1000).toISOString()
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

function createRealClient(opts: ErrorsClientOpts): NonNullable<ErrorsClientOpts["client"]> {
  // @google-cloud/error-reporting is the error-REPORTING agent; it has no
  // group-stats client at all (the class the first draft required never
  // existed). The stats API is a small REST surface and we already hold a
  // bearer token, so call it directly.
  return {
    async listGroupStats(o) {
      const { projectName, timeRange, pageSize } = o as {
        projectName: string; timeRange?: { period?: string }; pageSize?: number;
      };
      if (!opts.authToken) throw new Error("gcp errors: no auth token (gcloud ADC missing?)");
      const url = new URL(
        `https://clouderrorreporting.googleapis.com/v1beta1/${projectName}/groupStats`,
      );
      url.searchParams.set("timeRange.period", timeRange?.period ?? "PERIOD_1_DAY");
      url.searchParams.set("pageSize", String(pageSize ?? 20));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${opts.authToken}` } });
      if (!res.ok) {
        throw new Error(`gcp errors: groupStats HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const body = (await res.json()) as { errorGroupStats?: unknown[] };
      return [body.errorGroupStats ?? []];
    },
  };
}
