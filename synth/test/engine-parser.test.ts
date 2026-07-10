import { describe, expect, test } from "bun:test";
import { parsePlanResponse } from "../src/engine/parser";

describe("plan parser", () => {
  test("parses well-formed JSON", () => {
    const text = JSON.stringify({
      plan_id: "p_abc", goal: "g", created_at: "2026-05-16T12:00:00Z",
      nodes: [{ id: "n1", primitive: { op: "read_file", path: "/a" }, depends_on: [] }],
    });
    const plan = parsePlanResponse(text);
    expect(plan.plan_id).toBe("p_abc");
    expect(plan.nodes.length).toBe(1);
  });

  test("handles fenced code block in response", () => {
    const text = "Here's the plan:\n\n```json\n" + JSON.stringify({
      plan_id: "p_xyz", goal: "g", created_at: "x",
      nodes: [{ id: "n1", primitive: { op: "read_file", path: "/a" }, depends_on: [] }],
    }) + "\n```\nLet me know.";
    const plan = parsePlanResponse(text);
    expect(plan.plan_id).toBe("p_xyz");
  });

  test("throws on missing required fields", () => {
    expect(() => parsePlanResponse('{"plan_id":"p","nodes":[]}')).toThrow(/goal/);
  });

  test("throws on malformed JSON", () => {
    expect(() => parsePlanResponse("{not json}")).toThrow(/JSON/);
  });
});
