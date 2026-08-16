import { describe, expect, test } from "bun:test";
import { createMonitoringClient } from "../src/adapters/gcp/monitoring";

describe("GCP Monitoring client", () => {
  test("returns latency distribution per endpoint", async () => {
    const mock = {
      async listTimeSeries(): Promise<[unknown[]]> {
        return [[
          {
            // Real request_latencies shape: identity on the resource, class on the metric.
            metric: { labels: { response_code_class: "2xx" } },
            resource: { labels: { service_name: "lezam-app" } },
            points: [
              { value: { distributionValue: { mean: 300, count: "1000", bucketCounts: ["100","200","700"] } } },
            ],
          },
        ]];
      },
    };
    const client = createMonitoringClient({ projectId: "p", region: "me-central-2", client: mock });
    const out = await client.fetchLatency({
      window: { start: "2026-05-16T00:00:00Z", end: "2026-05-16T12:00:00Z" },
    });
    expect(out.per_endpoint.length).toBe(1);
    expect(out.per_endpoint[0].endpoint).toBe("lezam-app [2xx]");
    expect(out.per_endpoint[0].count).toBe(1000);
    expect(out.region).toBe("me-central-2");
  });
});
