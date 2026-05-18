import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize } from "../src/engine/synthesize";
import { executePlan } from "../src/executor";

describe("synth e2e (mock LLM)", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "synth-e2e-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  test("synthesize then validate then execute (read-only plan)", async () => {
    const fakeLlm = async () => JSON.stringify({
      plan_id: "p_e2e", goal: "show last 3 commits",
      created_at: "2026-05-16T12:00:00Z",
      nodes: [
        { id: "n1", primitive: { op: "git_log", range: "HEAD~3..HEAD" }, depends_on: [] },
      ],
      estimated_cost_usd: 0.001,
    });
    const sr = await synthesize({
      goal: "show last 3 commits",
      projectContext: { branch: "main", recentCommits: [] },
      llmCall: fakeLlm,
    });
    expect(sr.ok).toBe(true);
    if (!sr.ok) return;

    const result = await executePlan(sr.plan, {
      cwd,
      runner: async (node) => ({ kind: "text", value: `mock output for ${node.id}` }),
    });
    expect(result.status).toBe("completed");
    expect(result.outputs.n1.kind).toBe("text");
  });

  test("synthesize rejects plan with mutating primitive", async () => {
    const fakeLlm = async () => JSON.stringify({
      plan_id: "p_bad", goal: "g", created_at: "x",
      nodes: [{ id: "n1", primitive: { op: "write_file", path: "/x", content: "y" }, depends_on: [] }],
    });
    const sr = await synthesize({
      goal: "commit something",
      projectContext: { branch: "main", recentCommits: [] },
      llmCall: fakeLlm,
    });
    expect(sr.ok).toBe(false);
  });
});
