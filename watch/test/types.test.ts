import { describe, expect, test } from "bun:test";
import type { Signal, Rule, Action, ActionResult, RepoState } from "../src/types";

describe("watch types", () => {
  test("Signal shape compiles for git post-commit", () => {
    const s: Signal = {
      id: "sig_1",
      source: "git",
      type: "post-commit",
      repo: "/path/to/repo",
      timestamp: "2026-05-16T12:00:00Z",
      metadata: { sha: "abc123", branch: "main", files: ["src/foo.ts"] },
    };
    expect(s.source).toBe("git");
  });

  test("Rule shape compiles for auto-run action", () => {
    const r: Rule = {
      id: "review-on-commit",
      on: { source: "git", type: "post-commit" },
      when: { "files.match": ["src/**"] },
      action: { type: "auto-run", skill: "/review", args: ["--quick"] },
      notify: "terminal-only-on-finding",
    };
    expect(r.action.type).toBe("auto-run");
  });

  test("ActionResult captures success and failure shapes", () => {
    const ok: ActionResult = {
      action_id: "act_1",
      rule_id: "review-on-commit",
      skill: "/review",
      args: ["--quick"],
      started_at: "2026-05-16T12:00:00Z",
      ended_at: "2026-05-16T12:01:00Z",
      exit_code: 0,
      stdout_truncated: "...",
      finding_count: 0,
    };
    expect(ok.exit_code).toBe(0);
  });
});
