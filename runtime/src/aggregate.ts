import type { RuntimeAdapter } from "./adapters/base";
import type { LatencyDist, RuntimeSignal, Severity, TimeWindow } from "./types";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

export function rankSeverity(signals: RuntimeSignal[]): RuntimeSignal[] {
  return [...signals].sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (r !== 0) return r;
    return (b.count ?? 0) - (a.count ?? 0);
  });
}

export interface AggregateResult {
  errors: RuntimeSignal[];
  logs: RuntimeSignal[];
  latency_by_provider: LatencyDist[];
  incidents: RuntimeSignal[];
  deployments: RuntimeSignal[];
  adapter_failures: { provider: string; method: string; error: string }[];
}

export async function aggregateSignals(
  adapters: RuntimeAdapter[],
  window: TimeWindow,
): Promise<AggregateResult> {
  const errors: RuntimeSignal[] = [];
  const logs: RuntimeSignal[] = [];
  const latency: LatencyDist[] = [];
  const incidents: RuntimeSignal[] = [];
  const deployments: RuntimeSignal[] = [];
  const failures: AggregateResult["adapter_failures"] = [];

  const methodCalls: { provider: string; method: string; promise: Promise<unknown> }[] = [];
  for (const a of adapters) {
    methodCalls.push({ provider: a.id, method: "fetchErrors", promise: a.fetchErrors(window) });
    methodCalls.push({ provider: a.id, method: "fetchRecentLogs", promise: a.fetchRecentLogs(window) });
    methodCalls.push({ provider: a.id, method: "fetchLatencyDist", promise: a.fetchLatencyDist(window) });
    methodCalls.push({ provider: a.id, method: "fetchActiveIncidents", promise: a.fetchActiveIncidents() });
    methodCalls.push({ provider: a.id, method: "fetchDeployments", promise: a.fetchDeployments(window) });
  }

  const settled = await Promise.allSettled(methodCalls.map(c => c.promise));
  for (let i = 0; i < settled.length; i++) {
    const { provider, method } = methodCalls[i];
    const result = settled[i];
    if (result.status === "rejected") {
      failures.push({ provider, method, error: String((result.reason as Error)?.message ?? result.reason) });
      continue;
    }
    const value = result.value;
    if (method === "fetchErrors")           errors.push(...(value as RuntimeSignal[]));
    else if (method === "fetchRecentLogs")  logs.push(...(value as RuntimeSignal[]));
    else if (method === "fetchLatencyDist") latency.push(value as LatencyDist);
    else if (method === "fetchActiveIncidents") incidents.push(...(value as RuntimeSignal[]));
    else if (method === "fetchDeployments") deployments.push(...(value as RuntimeSignal[]));
  }

  return {
    errors: rankSeverity(errors),
    logs: rankSeverity(logs),
    latency_by_provider: latency,
    incidents,
    deployments,
    adapter_failures: failures,
  };
}
