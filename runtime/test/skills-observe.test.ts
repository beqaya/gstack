import { describe, expect, test } from "bun:test";
import { renderObserveSummary } from "../src/skills/observe";
import type { AggregateResult } from "../src/aggregate";

describe("/observe summary renderer", () => {
  test("renders header + counts + top errors + latency", () => {
    const agg: AggregateResult = {
      errors: [
        { type: "error", provider: "gcp", timestamp: "2026-05-16T12:00:00Z", severity: "critical",
          message: "DatabaseConnectionError: timeout", count: 45,
          raw_link: "https://console.cloud.google.com/errors/abc", metadata: { services: ["api"] } },
      ],
      logs: [],
      latency_by_provider: [{
        provider: "gcp", region: "me-central-2", window: { start: "", end: "" },
        per_endpoint: [{ endpoint: "GET /tenants", p50_ms: 100, p95_ms: 340, p99_ms: 800, count: 1200 }],
      }],
      incidents: [],
      deployments: [],
      adapter_failures: [],
    };
    const out = renderObserveSummary(agg, { region: "me-central-2", projectName: "lezam-prod" });
    expect(out).toContain("PROD HEALTH");
    expect(out).toContain("DatabaseConnectionError");
    expect(out).toContain("GET /tenants");
    expect(out).toContain("p95 340ms");
    expect(out).toContain("me-central-2");
  });

  test("notes when no signals were retrieved", () => {
    const empty: AggregateResult = {
      errors: [], logs: [], latency_by_provider: [],
      incidents: [], deployments: [], adapter_failures: [],
    };
    const out = renderObserveSummary(empty, { region: "me-central-2", projectName: "lezam-prod" });
    expect(out).toContain("no signals");
  });

  test("surfaces adapter failures separately", () => {
    const agg: AggregateResult = {
      errors: [], logs: [], latency_by_provider: [],
      incidents: [], deployments: [],
      adapter_failures: [{ provider: "gcp", method: "fetchErrors", error: "401 Unauthorized" }],
    };
    const out = renderObserveSummary(agg, { region: "me-central-2", projectName: "lezam-prod" });
    expect(out).toContain("ADAPTER FAILURES");
    expect(out).toContain("401 Unauthorized");
  });
});
