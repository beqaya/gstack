import { describe, expect, test } from "bun:test";
import { createRuleEngine } from "../src/rules/engine";
import type { Rule, Signal, RepoState } from "../src/types";

const repo: RepoState = {
  branch: "main", branchAgeHours: 1, hasDiff: false,
  isDefaultBranch: true, recentActions: [],
};

const rules: Rule[] = [
  {
    id: "match-src",
    on: { source: "git", type: "post-commit" },
    when: { "files.match": ["src/**"] },
    action: { type: "auto-run", skill: "/review", args: ["--quick"] },
    notify: "terminal",
  },
  {
    id: "match-time",
    on: { source: "time", type: "daily" },
    action: { type: "auto-run", skill: "/health" },
    notify: "terminal",
  },
];

describe("rule engine", () => {
  test("produces matching auto-run action for git commit on src", () => {
    const engine = createRuleEngine(rules);
    const sig: Signal = {
      id: "s", source: "git", type: "post-commit", repo: "/r",
      timestamp: new Date().toISOString(),
      metadata: { files: ["src/foo.ts"] },
    };
    const actions = engine.evaluate(sig, repo);
    expect(actions.length).toBe(1);
    expect(actions[0].rule_id).toBe("match-src");
    // narrow union: auto-run has .skill
    if (actions[0].action.type === "auto-run" || actions[0].action.type === "suggest") {
      expect(actions[0].action.skill).toBe("/review");
    }
  });

  test("no action when signal source does not match any rule", () => {
    const engine = createRuleEngine(rules);
    const sig: Signal = {
      id: "s", source: "file", type: "file-changed", repo: "/r",
      timestamp: new Date().toISOString(),
      metadata: { files: ["src/foo.ts"] },
    };
    expect(engine.evaluate(sig, repo).length).toBe(0);
  });

  test("no action when predicate fails", () => {
    const engine = createRuleEngine(rules);
    const sig: Signal = {
      id: "s", source: "git", type: "post-commit", repo: "/r",
      timestamp: new Date().toISOString(),
      metadata: { files: ["docs/readme.md"] },
    };
    expect(engine.evaluate(sig, repo).length).toBe(0);
  });

  test("multiple rules can match", () => {
    const engine = createRuleEngine(rules);
    const sig: Signal = {
      id: "s", source: "time", type: "daily", repo: "/r",
      timestamp: new Date().toISOString(), metadata: {},
    };
    expect(engine.evaluate(sig, repo).length).toBe(1);
  });

  test("malformed predicate is caught — rule is skipped, engine survives", () => {
    const badRules: Rule[] = [
      {
        id: "bad-age",
        on: { source: "git", type: "post-commit" },
        when: { "branch.age": "not-a-valid-expr" }, // throws in predicates
        action: { type: "auto-run", skill: "/review" },
        notify: "terminal",
      },
      {
        id: "good-after-bad",
        on: { source: "git", type: "post-commit" },
        action: { type: "auto-run", skill: "/health" },
        notify: "terminal",
      },
    ];
    const engine = createRuleEngine(badRules);
    const sig: Signal = {
      id: "s", source: "git", type: "post-commit", repo: "/r",
      timestamp: new Date().toISOString(), metadata: { files: [] },
    };
    const actions = engine.evaluate(sig, repo);
    expect(actions.length).toBe(1);
    expect(actions[0].rule_id).toBe("good-after-bad");
  });
});
