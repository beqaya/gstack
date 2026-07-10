import { describe, expect, test } from "bun:test";
import { evaluatePredicates } from "../src/rules/predicates";
import type { Signal, RepoState } from "../src/types";

const baseRepo: RepoState = {
  branch: "feature/x",
  branchAgeHours: 10,
  hasDiff: true,
  isDefaultBranch: false,
  recentActions: [],
};

const baseSignal: Signal = {
  id: "s1",
  source: "git",
  type: "post-commit",
  repo: "/r",
  timestamp: new Date().toISOString(),
  metadata: { files: ["src/foo.ts", "test/foo.test.ts"] },
};

describe("predicates", () => {
  test("files.match returns true for matching glob", () => {
    expect(evaluatePredicates({ "files.match": ["src/**"] }, baseSignal, baseRepo)).toBe(true);
  });

  test("files.match returns false when no files match", () => {
    expect(evaluatePredicates({ "files.match": ["docs/**"] }, baseSignal, baseRepo)).toBe(false);
  });

  test("branch.age comparison >", () => {
    expect(evaluatePredicates({ "branch.age": "> 5h" }, baseSignal, baseRepo)).toBe(true);
    expect(evaluatePredicates({ "branch.age": "> 50h" }, baseSignal, baseRepo)).toBe(false);
  });

  test("branch.has_diff boolean", () => {
    expect(evaluatePredicates({ "branch.has_diff": true }, baseSignal, baseRepo)).toBe(true);
  });

  test("empty predicates always true", () => {
    expect(evaluatePredicates(undefined, baseSignal, baseRepo)).toBe(true);
    expect(evaluatePredicates({}, baseSignal, baseRepo)).toBe(true);
  });

  test("all predicates AND-ed (one false = false)", () => {
    expect(evaluatePredicates(
      { "files.match": ["src/**"], "branch.age": "> 50h" },
      baseSignal, baseRepo
    )).toBe(false);
  });
});
