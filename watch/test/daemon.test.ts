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

  test("executor throw still releases limiter slot", async () => {
    let attempts = 0;
    const daemon = await startDaemon({
      repos: ["/repo1"],
      socketPath: null,
      enableFileWatcher: false,
      enableScheduler: false,
      maxConcurrent: 1,
      executorOverride: async (action, repo) => {
        attempts++;
        if (attempts === 1) throw new Error("first one fails");
        return {
          action_id: action.action_id, rule_id: action.rule_id,
          skill: action.action.type === "auto-run" || action.action.type === "suggest" ? action.action.skill : "",
          args: action.action.type === "auto-run" || action.action.type === "suggest" ? (action.action.args ?? []) : [],
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          exit_code: 0, stdout_truncated: "",
        };
      },
    });

    // First call throws but limiter released
    await daemon.injectSignal({
      id: "s1", source: "git", type: "post-commit", repo: "/repo1",
      timestamp: new Date().toISOString(),
      metadata: { files: ["src/foo.ts"] },
    });

    // Second call should still acquire (limiter freed after throw)
    await daemon.injectSignal({
      id: "s2", source: "git", type: "post-commit", repo: "/repo1",
      timestamp: new Date().toISOString(),
      metadata: { files: ["src/bar.ts"] },
    });

    expect(attempts).toBe(2);
    await daemon.stop();
  });

  test("signal matching no rules produces no executor call", async () => {
    const calls: any[] = [];
    const daemon = await startDaemon({
      repos: ["/repo1"],
      socketPath: null, enableFileWatcher: false, enableScheduler: false,
      executorOverride: async (a) => {
        calls.push(a);
        return {
          action_id: a.action_id, rule_id: a.rule_id, skill: "", args: [],
          started_at: "", ended_at: "", exit_code: 0, stdout_truncated: "",
        };
      },
    });

    // Signal with source="unknown" matches no rule
    await daemon.injectSignal({
      id: "s", source: "file" as any, type: "never-matches-this-type",
      repo: "/repo1", timestamp: new Date().toISOString(), metadata: {},
    });

    expect(calls.length).toBe(0);
    await daemon.stop();
  });

  test("stop() with no signal sources resolves cleanly", async () => {
    const daemon = await startDaemon({
      repos: ["/repo1"],
      socketPath: null, enableFileWatcher: false, enableScheduler: false,
    });
    await expect(daemon.stop()).resolves.toBeUndefined();
  });
});
