import { describe, expect, test } from "bun:test";
import type { RuntimeAdapter } from "../src/adapters/base";

describe("RuntimeAdapter shape", () => {
  test("mock adapter compiles and conforms", async () => {
    const mock: RuntimeAdapter = {
      id: "mock",
      async fetchErrors() { return []; },
      async fetchLatencyDist() {
        return { provider: "mock", window: { start: "", end: "" }, per_endpoint: [] };
      },
      async fetchRecentLogs() { return []; },
      async fetchActiveIncidents() { return []; },
      async fetchDeployments() { return []; },
      async healthCheck() {
        return { ok: true, provider: "mock", last_check: new Date().toISOString(), auth_present: true };
      },
    };
    const h = await mock.healthCheck();
    expect(h.ok).toBe(true);
  });
});
