import { describe, expect, test } from "bun:test";
import { startDaemon } from "../src/daemon";

describe("daemon main loop (smoke)", () => {
  test("wires signal → engine → executor and produces an ActionResult", async () => {
    const executedActions: any[] = [];
    const daemon = await startDaemon({
      repos: ["/repo1"],
      socketPath: null,                        // disable socket for smoke test
      enableFileWatcher: false,
      enableScheduler: false,
      executorOverride: async (action, repo) => {
        // action.action is a discriminated union; narrow before accessing skill
        const skill =
          action.action.type === "auto-run" || action.action.type === "suggest"
            ? action.action.skill
            : "(unknown)";
        const args =
          action.action.type === "auto-run" || action.action.type === "suggest"
            ? action.action.args ?? []
            : [];
        executedActions.push({ rule: action.rule_id, repo });
        return {
          action_id: action.action_id, rule_id: action.rule_id,
          skill, args,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          exit_code: 0, stdout_truncated: "",
        };
      },
    });

    await daemon.injectSignal({
      id: "test_sig", source: "git", type: "post-commit",
      repo: "/repo1", timestamp: new Date().toISOString(),
      metadata: { files: ["src/foo.ts"] },
    });

    await new Promise(r => setTimeout(r, 100));
    expect(executedActions.length).toBe(1);
    expect(executedActions[0].rule).toBe("quick-review-on-commit");

    await daemon.stop();
  });
});
