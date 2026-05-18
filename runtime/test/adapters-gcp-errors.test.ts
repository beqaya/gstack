import { describe, expect, test } from "bun:test";
import { createErrorsClient } from "../src/adapters/gcp/errors";

describe("GCP Error Reporting client wrapper", () => {
  test("returns normalized error signals", async () => {
    const mock = {
      async listGroupStats(): Promise<[unknown[]]> {
        return [[
          {
            group: { groupId: "abc" },
            count: "42",
            firstSeenTime: { seconds: "1747400000" },
            representative: { message: "TypeError: bad" },
            affectedServices: [{ service: "api" }],
          },
        ]];
      },
    };
    const client = createErrorsClient({ projectId: "p", client: mock });
    const out = await client.fetchErrorGroups({
      window: { start: "2026-05-16T00:00:00Z", end: "2026-05-16T12:00:00Z" },
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("error");
    expect(out[0].count).toBe(42);
    expect(out[0].message).toContain("TypeError");
    expect(out[0].metadata.group_id).toBe("abc");
    expect(out[0].raw_link).toContain("console.cloud.google.com/errors");
  });
});
