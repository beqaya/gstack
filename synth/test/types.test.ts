import { describe, expect, test } from "bun:test";
import type { Primitive, Plan, PlanNode, ExecutionResult } from "../src/types";

describe("synth types", () => {
  test("Primitive union compiles for read_file", () => {
    const p: Primitive = { op: "read_file", path: "/tmp/x" };
    expect(p.op).toBe("read_file");
  });

  test("Primitive union compiles for grep", () => {
    const p: Primitive = { op: "grep", pattern: "TODO", glob: "src/**/*.ts" };
    expect(p.op).toBe("grep");
  });

  test("Plan with node graph compiles", () => {
    const node: PlanNode = {
      id: "n1",
      primitive: { op: "read_file", path: "/a" },
      depends_on: [],
    };
    const plan: Plan = {
      plan_id: "p1",
      goal: "show file content",
      created_at: "2026-05-16T12:00:00Z",
      nodes: [node],
      estimated_cost_usd: 0.001,
    };
    expect(plan.nodes.length).toBe(1);
  });

  test("ExecutionResult captures success and outputs", () => {
    const r: ExecutionResult = {
      plan_id: "p1",
      started_at: "2026-05-16T12:00:00Z",
      ended_at: "2026-05-16T12:00:05Z",
      status: "completed",
      outputs: { n1: { kind: "text", value: "file content here" } },
      node_results: [{ node_id: "n1", status: "completed", started_at: "x", ended_at: "y" }],
    };
    expect(r.status).toBe("completed");
  });
});
