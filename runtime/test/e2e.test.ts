import { describe, expect, test } from "bun:test";
import { createGcpAdapter } from "../src/adapters/gcp";
import { aggregateSignals } from "../src/aggregate";
import { createRedactEngine } from "../src/redact/engine";
import { renderObserveSummary } from "../src/skills/observe";
import type { LatencyDist, RuntimeSignal } from "../src/types";
import type { LoggingClient } from "../src/adapters/gcp/logging";
import type { ErrorsClient } from "../src/adapters/gcp/errors";
import type { MonitoringClient } from "../src/adapters/gcp/monitoring";

describe("/observe e2e (mock GCP, redaction enabled)", () => {
  test("full flow: GCP fixtures → aggregate → redact → render", async () => {
    const fakeErr: RuntimeSignal = {
      type: "error", provider: "gcp",
      timestamp: "2026-05-16T12:00:00Z",
      severity: "critical",
      message: "User alice@lezam.sa got 500 — tenant 1234567890 not found",
      count: 12,
      raw_link: "https://console.cloud.google.com/errors/abc?project=lezam",
      metadata: { services: ["api"] },
    };
    const fakeLatency: LatencyDist = {
      provider: "gcp", region: "me-central-2",
      window: { start: "x", end: "y" },
      per_endpoint: [{ endpoint: "GET /tenants/:id", p50_ms: 100, p95_ms: 410, p99_ms: 900, count: 1200 }],
    };
    const adapter = createGcpAdapter({
      projectId: "lezam-prod-me-central-2",
      region: "me-central-2",
      regionLock: true,
      authToken: "mock-token",
      mocks: {
        logging: { async fetchLogs() { return []; } } as LoggingClient,
        errors: { async fetchErrorGroups() { return [fakeErr]; } } as ErrorsClient,
        monitoring: { async fetchLatency() { return fakeLatency; } } as MonitoringClient,
      },
    });

    const window = { start: "2026-05-15T12:00:00Z", end: "2026-05-16T12:00:00Z" };
    const agg = await aggregateSignals([adapter], window);

    expect(agg.errors.length).toBe(1);
    expect(agg.errors[0].message).toContain("alice@lezam.sa");
    expect(agg.errors[0].message).toContain("1234567890");

    const redact = await createRedactEngine(["email", "national_id_ksa"]);
    agg.errors = redact.redactArray(agg.errors);

    expect(agg.errors[0].message).not.toContain("alice@lezam.sa");
    expect(agg.errors[0].message).not.toContain("1234567890");
    expect(agg.errors[0].message).toContain("<REDACTED-EMAIL>");
    expect(agg.errors[0].message).toContain("<national_id_ksa>");

    const summary = renderObserveSummary(agg, {
      region: "me-central-2", projectName: "lezam-prod-me-central-2",
    });
    expect(summary).toContain("PROD HEALTH");
    expect(summary).toContain("<REDACTED-EMAIL>");
    expect(summary).toContain("p95 410ms");
    expect(summary).not.toContain("alice@lezam.sa");
    expect(summary).not.toContain("1234567890");
  });

  test("region lock construction succeeds for matching region", () => {
    expect(() => createGcpAdapter({
      projectId: "p", region: "me-central-2", regionLock: true, authToken: "t",
      mocks: { logging: {} as LoggingClient, errors: {} as ErrorsClient, monitoring: {} as MonitoringClient },
    })).not.toThrow();
  });
});
