import { describe, expect, test } from "bun:test";
import { validatePlan } from "../src/validator";
import type { Plan, Primitive } from "../src/types";

const basePlan: Plan = {
  plan_id: "p1", goal: "g", created_at: "x",
  nodes: [
    { id: "n1", primitive: { op: "read_file", path: "/abs/a" }, depends_on: [] },
    { id: "n2", primitive: { op: "grep", pattern: "TODO" }, depends_on: ["n1"] },
  ],
};

describe("plan validator", () => {
  test("accepts a valid plan", () => {
    const r = validatePlan(basePlan);
    expect(r.ok).toBe(true);
  });

  test("rejects unknown primitive op", () => {
    const bad: Plan = { ...basePlan, nodes: [
      { id: "n", primitive: { op: "write_file" } as unknown as Primitive, depends_on: [] },
    ]};
    const r = validatePlan(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /not registered/.test(e))).toBe(true);
  });

  test("rejects cycle", () => {
    const cyclic: Plan = { ...basePlan, nodes: [
      { id: "a", primitive: { op: "read_file", path: "/abs/x" }, depends_on: ["b"] },
      { id: "b", primitive: { op: "read_file", path: "/abs/y" }, depends_on: ["a"] },
    ]};
    const r = validatePlan(cyclic);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /cycle/i.test(e))).toBe(true);
  });

  test("rejects missing dependency", () => {
    const dangling: Plan = { ...basePlan, nodes: [
      { id: "n1", primitive: { op: "read_file", path: "/abs/x" }, depends_on: ["ghost"] },
    ]};
    const r = validatePlan(dangling);
    expect(r.ok).toBe(false);
  });

  test("rejects plan exceeding max nodes (50)", () => {
    const big: Plan = { ...basePlan, nodes: Array.from({ length: 51 }, (_, i) => ({
      id: `n${i}`, primitive: { op: "read_file" as const, path: `/abs/${i}` }, depends_on: [],
    })) };
    const r = validatePlan(big);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /50/.test(e))).toBe(true);
  });

  test("rejects depth exceeding 6", () => {
    const nodes = [];
    for (let i = 0; i < 8; i++) {
      nodes.push({
        id: `n${i}`,
        primitive: { op: "read_file" as const, path: `/abs/${i}` },
        depends_on: i === 0 ? [] : [`n${i - 1}`],
      });
    }
    const r = validatePlan({ ...basePlan, nodes });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /depth/i.test(e))).toBe(true);
  });

  test("rejects mutating primitive (defense in depth)", () => {
    const mutating: Plan = { ...basePlan, nodes: [
      { id: "n", primitive: { op: "write_file" } as unknown as Primitive, depends_on: [] },
    ]};
    const r = validatePlan(mutating);
    expect(r.ok).toBe(false);
  });
});
