import type { RuntimeSignal, LatencyDist, TimeWindow, FilterOpts, AdapterHealth } from "../types";

export interface RuntimeAdapter {
  id: string;
  fetchErrors(window: TimeWindow, opts?: FilterOpts): Promise<RuntimeSignal[]>;
  fetchLatencyDist(window: TimeWindow, opts?: FilterOpts): Promise<LatencyDist>;
  fetchRecentLogs(window: TimeWindow, opts?: FilterOpts): Promise<RuntimeSignal[]>;
  fetchActiveIncidents(): Promise<RuntimeSignal[]>;
  fetchDeployments(window: TimeWindow): Promise<RuntimeSignal[]>;
  healthCheck(): Promise<AdapterHealth>;
}

export function defaultWindow(hours: number): TimeWindow {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
