import { describe, expect, test } from "bun:test";
import { createGcpAdapter } from "../src/adapters/gcp";
import type { LatencyDist, RuntimeSignal } from "../src/types";
import type { LoggingClient } from "../src/adapters/gcp/logging";
import type { ErrorsClient } from "../src/adapters/gcp/errors";
import type { MonitoringClient } from "../src/adapters/gcp/monitoring";

describe("GCP adapter (composite)", () => {
  test("healthCheck returns ok when sub-clients respond", async () => {
    const adapter = createGcpAdapter({
      projectId: "lezam-prod",
      region: "me-central-2",
      regionLock: true,
      authToken: "test-token",
      mocks: {
        logging: { async fetchLogs() { return []; } } as LoggingClient,
        errors: { async fetchErrorGroups() { return []; } } as ErrorsClient,
        monitoring: {
          async fetchLatency(): Promise<LatencyDist> {
            return { provider: "gcp", region: "me-central-2", window: { start: "", end: "" }, per_endpoint: [] };
          },
        } as MonitoringClient,
      },
    });
    const h = await adapter.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.region).toBe("me-central-2");
  });

  test("healthCheck reports auth missing when no token", async () => {
    const adapter = createGcpAdapter({
      projectId: "lezam-prod", region: "me-central-2", regionLock: true,
      authToken: null,
      mocks: { logging: {} as LoggingClient, errors: {} as ErrorsClient, monitoring: {} as MonitoringClient },
    });
    const h = await adapter.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.auth_present).toBe(false);
  });

  test("fetchErrors goes through error reporting client", async () => {
    const fakeErr: RuntimeSignal = {
      type: "error", provider: "gcp",
      timestamp: "2026-05-16T12:00:00Z",
      severity: "high", message: "x",
      count: 5, raw_link: "u", metadata: {},
    };
    const adapter = createGcpAdapter({
      projectId: "p", region: "me-central-2", regionLock: false, authToken: "t",
      mocks: {
        logging: { async fetchLogs() { return []; } } as LoggingClient,
        errors: { async fetchErrorGroups() { return [fakeErr]; } } as ErrorsClient,
        monitoring: {
          async fetchLatency(): Promise<LatencyDist> {
            return { provider: "gcp", region: "me-central-2", window: { start: "", end: "" }, per_endpoint: [] };
          },
        } as MonitoringClient,
      },
    });
    const out = await adapter.fetchErrors({ start: "x", end: "y" });
    expect(out.length).toBe(1);
  });
});
