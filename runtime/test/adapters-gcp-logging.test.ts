import { describe, expect, test } from "bun:test";
import { createLoggingClient } from "../src/adapters/gcp/logging";

describe("GCP Logging client wrapper (with mock client)", () => {
  test("forwards filter to underlying client", async () => {
    let lastFilter = "";
    const mockClient = {
      async getEntries(opts: { filter: string }): Promise<[unknown[]]> {
        lastFilter = opts.filter;
        return [[
          { metadata: { timestamp: "2026-05-16T12:00:00Z", severity: "ERROR" }, data: "log message" },
        ]];
      },
    };

    const client = createLoggingClient({ projectId: "p", client: mockClient });
    await client.fetchLogs({
      window: { start: "2026-05-16T00:00:00Z", end: "2026-05-16T12:00:00Z" },
      logFilter: 'resource.type="cloud_run_revision"',
      limit: 50,
    });
    expect(lastFilter).toContain('resource.type="cloud_run_revision"');
    expect(lastFilter).toContain("timestamp");
  });

  test("returns normalized log entries", async () => {
    const mockClient = {
      async getEntries(): Promise<[unknown[]]> {
        return [[
          { metadata: { timestamp: "2026-05-16T12:00:00Z", severity: "ERROR", resource: { labels: { service_name: "api" } } }, data: "boom" },
        ]];
      },
    };
    const client = createLoggingClient({ projectId: "p", client: mockClient });
    const out = await client.fetchLogs({
      window: { start: "2026-05-16T00:00:00Z", end: "2026-05-16T12:00:00Z" },
      logFilter: "",
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0].severity).toBe("high");
    expect(out[0].message).toBe("boom");
  });
});
