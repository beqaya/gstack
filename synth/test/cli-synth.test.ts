import { describe, expect, test } from "bun:test";
import { renderPlanForUser } from "../src/cli/synth";

describe("plan renderer", () => {
  test("renders plan with nodes and depends_on", () => {
    const out = renderPlanForUser({
      plan_id: "p_abc", goal: "find TODOs", created_at: "2026-05-16T12:00:00Z",
      nodes: [
        { id: "n1", primitive: { op: "grep", pattern: "TODO", glob: "src/**" }, depends_on: [], label: "scan source" },
        { id: "n2", primitive: { op: "grep", pattern: "FIXME", glob: "src/**" }, depends_on: [], label: "scan source for fixmes" },
        { id: "n3", primitive: { op: "parallel", steps: [{ ref: "n1" }, { ref: "n2" }] }, depends_on: ["n1", "n2"] },
      ],
      estimated_cost_usd: 0.002,
    });
    expect(out).toContain("p_abc");
    expect(out).toContain("find TODOs");
    expect(out).toContain("grep");
    expect(out).toContain("parallel");
    expect(out).toContain("$0.002");
  });
});
