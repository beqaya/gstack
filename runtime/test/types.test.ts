import { describe, expect, test } from "bun:test";
import type { RuntimeSignal, TimeWindow, FilterOpts, LatencyDist, ObservabilityConfig } from "../src/types";

describe("runtime types", () => {
  test("RuntimeSignal shape compiles for error type", () => {
    const s: RuntimeSignal = {
      type: "error",
      provider: "gcp",
      timestamp: "2026-05-16T12:00:00Z",
      severity: "high",
      message: "DatabaseConnectionError: timeout",
      region: "me-central-2",
      count: 45,
      raw_link: "https://console.cloud.google.com/errors/...",
      metadata: { service: "api" },
    };
    expect(s.type).toBe("error");
  });

  test("TimeWindow accepts ISO range", () => {
    const w: TimeWindow = { start: "2026-05-15T12:00:00Z", end: "2026-05-16T12:00:00Z" };
    expect(w.start < w.end).toBe(true);
  });

  test("LatencyDist captures p50/p95/p99", () => {
    const d: LatencyDist = {
      provider: "gcp", region: "me-central-2",
      window: { start: "2026-05-15T12:00:00Z", end: "2026-05-16T12:00:00Z" },
      per_endpoint: [{ endpoint: "GET /tenants", p50_ms: 100, p95_ms: 340, p99_ms: 800, count: 1200 }],
    };
    expect(d.per_endpoint[0].p95_ms).toBe(340);
  });

  test("ObservabilityConfig requires region when region_lock is true", () => {
    const c: ObservabilityConfig = {
      primary: "gcp",
      project_id: "lezam-prod",
      region: "me-central-2",
      region_lock: true,
      secondary: [],
      providers: { gcp: { services: ["api"] } },
      redact_patterns: ["email", "phone_ksa"],
    };
    expect(c.region_lock).toBe(true);
  });
});
