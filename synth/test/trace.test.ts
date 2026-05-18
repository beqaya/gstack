import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTraceLogger } from "../src/trace";

describe("trace logger", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "trace-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("writes plan + each node result", async () => {
    const logger = createTraceLogger("p_test", dir);
    await logger.writePlan({ plan_id: "p_test", goal: "g", created_at: "x", nodes: [] });
    await logger.writeNodeResult({ node_id: "n1", status: "completed", started_at: "x", ended_at: "y" });
    await logger.close();

    const content = readFileSync(join(dir, "p_test.jsonl"), "utf8").trim().split("\n");
    expect(content.length).toBe(2);
    expect(JSON.parse(content[0]).kind).toBe("plan");
    expect(JSON.parse(content[1]).kind).toBe("node_result");
  });
});
