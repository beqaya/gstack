import { describe, expect, test } from "bun:test";
import { aggregateSignals, rankSeverity } from "../src/aggregate";
import type { RuntimeSignal, LatencyDist } from "../src/types";
import type { RuntimeAdapter } from "../src/adapters/base";

const sig = (severity: RuntimeSignal["severity"], count?: number): RuntimeSignal => ({
  type: "error", provider: "gcp", timestamp: "x", severity, message: "x",
  count, raw_link: "x", metadata: {},
});

const fakeAdapter = (id: string, signals: RuntimeSignal[]): RuntimeAdapter => ({
  id,
  async fetchErrors() { return signals; },
  async fetchLatencyDist(): Promise<LatencyDist> {
    return { provider: id, window: { start: "", end: "" }, per_endpoint: [] };
  },
  async fetchRecentLogs() { return []; },
  async fetchActiveIncidents() { return []; },
  async fetchDeployments() { return []; },
  async healthCheck() {
    return { ok: true, provider: id, last_check: "x", auth_present: true };
  },
});

describe("aggregator", () => {
  test("sorts by severity then count desc", () => {
    const ranked = rankSeverity([
      sig("low", 10),
      sig("critical", 1),
      sig("high", 5),
      sig("high", 50),
    ]);
    expect(ranked[0].severity).toBe("critical");
    expect(ranked[1].severity).toBe("high");
    expect(ranked[1].count).toBe(50);
    expect(ranked[2].count).toBe(5);
  });

  test("aggregates across adapters using Promise.allSettled", async () => {
    const result = await aggregateSignals(
      [fakeAdapter("a", [sig("high", 5)]), fakeAdapter("b", [sig("critical", 1)])],
      { start: "x", end: "y" }
    );
    expect(result.errors.length).toBe(2);
    expect(result.errors[0].severity).toBe("critical");
  });

  test("a single adapter failure does not abort the rest", async () => {
    const ok = fakeAdapter("ok", [sig("high")]);
    const broken: RuntimeAdapter = { ...ok, id: "broken", async fetchErrors() { throw new Error("boom"); } };

    const result = await aggregateSignals([ok, broken], { start: "x", end: "y" });
    expect(result.errors.length).toBe(1);
    expect(result.adapter_failures.length).toBe(1);
    expect(result.adapter_failures[0].provider).toBe("broken");
  });
});
