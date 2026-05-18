import { describe, expect, test } from "bun:test";
import { executePlan } from "../src/executor";
import type { Plan, PrimitiveOutput, PlanNode } from "../src/types";

const plan: Plan = {
  plan_id: "p_exec_test", goal: "g", created_at: "x",
  nodes: [
    { id: "a", primitive: { op: "read_file", path: "/a" }, depends_on: [] },
    { id: "b", primitive: { op: "read_file", path: "/b" }, depends_on: [] },
    { id: "c", primitive: { op: "grep", pattern: "x" }, depends_on: ["a", "b"] },
  ],
};

describe("plan executor", () => {
  test("runs nodes in topological order via injected runner", async () => {
    const order: string[] = [];
    const runner = async (node: PlanNode): Promise<PrimitiveOutput> => {
      order.push(node.id);
      return { kind: "text", value: node.id };
    };
    const result = await executePlan(plan, { cwd: "/tmp", runner });
    expect(result.status).toBe("completed");
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(result.outputs.c.kind).toBe("text");
  });

  test("returns failed status on runner error", async () => {
    const runner = async (node: PlanNode): Promise<PrimitiveOutput> => {
      if (node.id === "c") throw new Error("boom");
      return { kind: "text", value: "ok" };
    };
    const result = await executePlan(plan, { cwd: "/tmp", runner });
    expect(result.status).toBe("failed");
    expect(result.node_results.find(r => r.node_id === "c")?.error).toContain("boom");
  });

  test("emits skipped records for nodes downstream of a failure", async () => {
    const planWithTail: Plan = {
      plan_id: "p_skip", goal: "g", created_at: "x",
      nodes: [
        { id: "a", primitive: { op: "read_file", path: "/a" }, depends_on: [] },
        { id: "b", primitive: { op: "read_file", path: "/b" }, depends_on: ["a"] },
        { id: "c", primitive: { op: "read_file", path: "/c" }, depends_on: ["b"] },
      ],
    };
    const runner = async (node: PlanNode): Promise<PrimitiveOutput> => {
      if (node.id === "a") throw new Error("boom");
      return { kind: "text", value: "ok" };
    };
    const result = await executePlan(planWithTail, { cwd: "/tmp", runner });
    expect(result.status).toBe("failed");
    expect(result.node_results.find(r => r.node_id === "a")?.status).toBe("failed");
    expect(result.node_results.find(r => r.node_id === "b")?.status).toBe("skipped");
    expect(result.node_results.find(r => r.node_id === "c")?.status).toBe("skipped");
  });
});
