import { describe, expect, test } from "bun:test";
import { synthesize } from "../src/engine/synthesize";

describe("synthesize orchestrator", () => {
  test("end-to-end synthesis returns a validated plan", async () => {
    const fakeLlm = async () => JSON.stringify({
      plan_id: "p_test",
      goal: "find TODOs",
      created_at: "2026-05-16T12:00:00Z",
      nodes: [
        { id: "n1", primitive: { op: "grep", pattern: "TODO", glob: "src/**" }, depends_on: [] },
      ],
      estimated_cost_usd: 0.002,
    });
    const result = await synthesize({
      goal: "find TODOs",
      projectContext: { branch: "main", recentCommits: [] },
      llmCall: fakeLlm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.plan_id).toBe("p_test");
      expect(result.plan.nodes.length).toBe(1);
    }
  });

  test("returns validation errors instead of throwing", async () => {
    const fakeLlm = async () => JSON.stringify({
      plan_id: "p_test", goal: "x", created_at: "x",
      nodes: [
        { id: "n1", primitive: { op: "write_file", path: "/x", content: "y" }, depends_on: [] },
      ],
    });
    const result = await synthesize({
      goal: "x",
      projectContext: { branch: "main", recentCommits: [] },
      llmCall: fakeLlm,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some(e => /not registered|mutating/.test(e))).toBe(true);
    }
  });
});
