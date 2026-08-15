import type { LatencyDist, LatencyBucket, TimeWindow } from "../../types";

export interface MonitoringClientOpts {
  projectId: string;
  region: string;
  client?: { listTimeSeries(opts: unknown): Promise<[unknown[], unknown?]> };
}

export interface MonitoringClient {
  fetchLatency(opts: { window: TimeWindow }): Promise<LatencyDist>;
}

interface GcpTimeSeries {
  metric?: { labels?: { method?: string; path?: string } };
  points?: { value?: { distributionValue?: { mean?: number; count?: string | number } } }[];
}

export function createMonitoringClient(opts: MonitoringClientOpts): MonitoringClient {
  const client = opts.client ?? createRealClient();
  return {
    async fetchLatency({ window }) {
      const [series] = await client.listTimeSeries({
        name: `projects/${opts.projectId}`,
        filter: `metric.type="run.googleapis.com/request_latencies"`,
        interval: { startTime: { seconds: toSec(window.start) }, endTime: { seconds: toSec(window.end) } },
      });
      const per_endpoint: LatencyBucket[] = (series as GcpTimeSeries[]).map(normalize);
      return {
        provider: "gcp",
        region: opts.region,
        window,
        per_endpoint,
      };
    },
  };
}

function toSec(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function normalize(s: GcpTimeSeries): LatencyBucket {
  const method = s.metric?.labels?.method ?? "?";
  const path = s.metric?.labels?.path ?? "?";
  const dist = s.points?.[0]?.value?.distributionValue;
  const count = Number(dist?.count ?? 0);
  const mean = Number(dist?.mean ?? 0);
  return {
    endpoint: `${method} ${path}`,
    p50_ms: Math.round(mean),
    p95_ms: Math.round(mean * 1.6),
    p99_ms: Math.round(mean * 2.4),
    count,
  };
}

function createRealClient(): NonNullable<MonitoringClientOpts["client"]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { MetricServiceClient } = require("@google-cloud/monitoring") as { MetricServiceClient: new () => { listTimeSeries(o: unknown): Promise<[unknown[]]> } };
  const c = new MetricServiceClient();
  return { async listTimeSeries(o) { return c.listTimeSeries(o); } };
}
