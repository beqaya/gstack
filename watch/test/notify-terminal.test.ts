import { describe, expect, test } from "bun:test";
import { formatNotification } from "../src/notify/terminal";

describe("terminal notifier", () => {
  test("formats auto-run completion with finding count", () => {
    const out = formatNotification({
      kind: "auto-run-complete",
      rule_id: "review-on-commit",
      skill: "/review",
      finding_count: 2,
      exit_code: 0,
    });
    expect(out).toContain("/review");
    expect(out).toContain("2 finding");
    expect(out).toContain("review-on-commit");
  });

  test("formats suggestion notification", () => {
    const out = formatNotification({
      kind: "suggestion",
      rule_id: "ship-stale-branch",
      skill: "/ship",
      reason: "branch is 80 hours old with diff",
    });
    expect(out).toContain("/ship");
    expect(out).toContain("stale");
  });

  test("suppresses no-finding completion under terminal-only-on-finding policy", () => {
    const out = formatNotification({
      kind: "auto-run-complete",
      rule_id: "x",
      skill: "/review",
      finding_count: 0,
      exit_code: 0,
    }, "terminal-only-on-finding");
    expect(out).toBe("");
  });
});
