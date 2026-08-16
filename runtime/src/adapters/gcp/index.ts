import type { LatencyDist, RuntimeSignal, TimeWindow, FilterOpts, AdapterHealth } from "../../types";
import type { RuntimeAdapter } from "../base";
import type { LoggingClient } from "./logging";
import type { ErrorsClient } from "./errors";
import type { MonitoringClient } from "./monitoring";
import { createLoggingClient } from "./logging";
import { createErrorsClient } from "./errors";
import { createMonitoringClient } from "./monitoring";
import { assertRegion } from "./region-lock";

export interface GcpAdapterOpts {
  projectId: string;
  region: string;
  regionLock: boolean;
  authToken: string | null;
  logFilter?: string;
  mocks?: {
    logging?: LoggingClient;
    errors?: ErrorsClient;
    monitoring?: MonitoringClient;
  };
}

export function createGcpAdapter(opts: GcpAdapterOpts): RuntimeAdapter {
  // Constructor-time region sanity check using the configured region itself.
  if (opts.regionLock) assertRegion(opts.region, `projects/${opts.projectId}/locations/${opts.region}`, true);

  const logging = opts.mocks?.logging ?? createLoggingClient({ projectId: opts.projectId });
  const errors  = opts.mocks?.errors  ?? createErrorsClient({ projectId: opts.projectId, authToken: opts.authToken });
  const monitoring = opts.mocks?.monitoring ?? createMonitoringClient({ projectId: opts.projectId, region: opts.region });

  return {
    id: "gcp",
    async fetchErrors(window: TimeWindow, fo?: FilterOpts): Promise<RuntimeSignal[]> {
      return errors.fetchErrorGroups({ window, limit: fo?.limit ?? 50 });
    },
    async fetchLatencyDist(window: TimeWindow): Promise<LatencyDist> {
      return monitoring.fetchLatency({ window });
    },
    async fetchRecentLogs(window: TimeWindow, fo?: FilterOpts): Promise<RuntimeSignal[]> {
      return logging.fetchLogs({
        window,
        logFilter: opts.logFilter ?? "",
        limit: fo?.limit ?? 100,
      });
    },
    async fetchActiveIncidents(): Promise<RuntimeSignal[]> {
      return [];
    },
    async fetchDeployments(): Promise<RuntimeSignal[]> {
      return [];
    },
    async healthCheck(): Promise<AdapterHealth> {
      const auth_present = opts.authToken !== null && opts.authToken.length > 0;
      return {
        ok: auth_present,
        provider: "gcp",
        last_check: new Date().toISOString(),
        message: auth_present ? "ok" : "no auth token configured",
        auth_present,
        region: opts.region,
      };
    },
  };
}
