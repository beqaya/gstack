import { describe, expect, test } from "bun:test";
import { buildSynthesisPrompt } from "../src/engine/prompt";

describe("synthesis prompt builder", () => {
  test("includes goal, primitive registry, JSON schema", () => {
    const p = buildSynthesisPrompt({
      goal: "find all TODO comments in src",
      projectContext: { branch: "main", recentCommits: [] },
      maxNodes: 50, maxDepth: 6,
    });
    expect(p).toContain("find all TODO comments");
    expect(p).toContain("read_file");
    expect(p).toContain("grep");
    expect(p).toContain("parallel");
    expect(p).toContain("Max nodes: 50");
    expect(p).toContain("plan_id");
    expect(p).toContain("READ-ONLY");
  });

  test("includes recent commits in context section", () => {
    const p = buildSynthesisPrompt({
      goal: "x",
      projectContext: { branch: "feature/y", recentCommits: ["abc fix bug", "def add feature"] },
      maxNodes: 50, maxDepth: 6,
    });
    expect(p).toContain("feature/y");
    expect(p).toContain("abc fix bug");
  });
});
