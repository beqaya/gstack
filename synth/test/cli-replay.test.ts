import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlanFromTrace } from "../src/cli/replay";

describe("replay loader", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "replay-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("extracts plan from JSONL trace", async () => {
    const trace = [
      JSON.stringify({ kind: "plan", ts: "x", plan: {
        plan_id: "p_abc", goal: "g", created_at: "y",
        nodes: [{ id: "n1", primitive: { op: "read_file", path: "/a" }, depends_on: [] }],
      }}),
      JSON.stringify({ kind: "node_result", ts: "x", node_id: "n1", status: "completed", started_at: "a", ended_at: "b" }),
      JSON.stringify({ kind: "final", ts: "x", status: "completed" }),
    ].join("\n");
    writeFileSync(join(dir, "p_abc.jsonl"), trace);
    const plan = await loadPlanFromTrace("p_abc", dir);
    expect(plan.plan_id).toBe("p_abc");
    expect(plan.nodes.length).toBe(1);
  });

  test("throws when plan_id not found", async () => {
    await expect(loadPlanFromTrace("ghost", dir)).rejects.toThrow();
  });
});
