import { describe, expect, test } from "bun:test";
import { evaluatePlan } from "../src/eval/runner";

describe("eval runner", () => {
  test("evaluatePlan returns pass when expected primitives are present", () => {
    const r = evaluatePlan({
      plan_id: "p", goal: "g", created_at: "x",
      nodes: [{ id: "n1", primitive: { op: "grep", pattern: "x" }, depends_on: [] }],
    }, {
      id: "g01", goal: "find TODOs", expected_primitives: ["grep"], min_nodes: 1, max_nodes: 3,
    });
    expect(r.ok).toBe(true);
  });

  test("evaluatePlan fails when expected primitive missing", () => {
    const r = evaluatePlan({
      plan_id: "p", goal: "g", created_at: "x",
      nodes: [{ id: "n1", primitive: { op: "read_file", path: "/x" }, depends_on: [] }],
    }, {
      id: "g01", goal: "find TODOs", expected_primitives: ["grep"], min_nodes: 1, max_nodes: 3,
    });
    expect(r.ok).toBe(false);
  });

  test("evaluatePlan fails when too many nodes", () => {
    const r = evaluatePlan({
      plan_id: "p", goal: "g", created_at: "x",
      nodes: Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`, primitive: { op: "grep" as const, pattern: "x" }, depends_on: [],
      })),
    }, {
      id: "g01", goal: "find TODOs", expected_primitives: ["grep"], min_nodes: 1, max_nodes: 3,
    });
    expect(r.ok).toBe(false);
  });
});
