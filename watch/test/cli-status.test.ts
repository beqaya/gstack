import { describe, expect, test } from "bun:test";
import { formatStatus } from "../src/cli/status";

describe("status formatter", () => {
  test("running state", () => {
    const out = formatStatus({
      running: true, pid: 12345, ruleCount: 3,
      watchedRepos: ["/path/lezam"], recentActionCount: 4,
    });
    expect(out).toContain("running");
    expect(out).toContain("12345");
    expect(out).toContain("3 rules");
    expect(out).toContain("/path/lezam");
  });

  test("not-running state", () => {
    const out = formatStatus({
      running: false, pid: null, ruleCount: 0, watchedRepos: [], recentActionCount: 0,
    });
    expect(out).toContain("not running");
  });
});
