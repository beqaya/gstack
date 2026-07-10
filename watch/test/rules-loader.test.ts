import { describe, expect, test } from "bun:test";
import { loadDefaultRules } from "../src/rules/loader";

describe("rules loader", () => {
  test("loads default rule pack with 3 rules", async () => {
    const rules = await loadDefaultRules();
    expect(rules.length).toBe(3);
    const ids = rules.map(r => r.id).sort();
    expect(ids).toEqual(["daily-health", "investigate-on-ci-fail", "quick-review-on-commit"]);
  });

  test("default review rule auto-runs /review --quick on src/** commits", async () => {
    const rules = await loadDefaultRules();
    const rule = rules.find(r => r.id === "quick-review-on-commit")!;
    expect(rule.on.source).toBe("git");
    expect(rule.on.type).toBe("post-commit");
    expect(rule.action.type).toBe("auto-run");
    if (rule.action.type !== "auto-run" && rule.action.type !== "suggest") {
      throw new Error("expected auto-run action with skill");
    }
    expect(rule.action.skill).toBe("/review");
    expect(rule.action.args).toEqual(["--quick"]);
  });

  test("default health rule fires daily", async () => {
    const rules = await loadDefaultRules();
    const rule = rules.find(r => r.id === "daily-health")!;
    expect(rule.on.source).toBe("time");
    expect(rule.on.type).toBe("daily");
    if (rule.action.type !== "auto-run" && rule.action.type !== "suggest") {
      throw new Error("expected auto-run action with skill");
    }
    expect(rule.action.skill).toBe("/health");
  });

  test("investigate rule is registered (will be inert until Phase 2)", async () => {
    const rules = await loadDefaultRules();
    const rule = rules.find(r => r.id === "investigate-on-ci-fail")!;
    expect(rule.on.source).toBe("ci");
    if (rule.action.type !== "auto-run" && rule.action.type !== "suggest") {
      throw new Error("expected auto-run action with skill");
    }
    expect(rule.action.skill).toBe("/investigate");
  });
});
