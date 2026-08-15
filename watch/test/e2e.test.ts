import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import type { ResolvedAction } from "../src/rules/engine";

function skillOf(action: ResolvedAction): string {
  return action.action.type === "auto-run" || action.action.type === "suggest"
    ? action.action.skill
    : "";
}
function argsOf(action: ResolvedAction): string[] {
  return action.action.type === "auto-run" || action.action.type === "suggest"
    ? action.action.args ?? []
    : [];
}

describe("e2e: git commit signal triggers /review auto-run", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "e2e-"));
    mkdirSync(join(tmp, ".git", "hooks"), { recursive: true });
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test("post-commit signal on src/foo.ts produces a /review --quick action", async () => {
    const captured: { skill: string; args: string[]; repo: string }[] = [];

    const daemon = await startDaemon({
      repos: [tmp],
      socketPath: null,
      enableFileWatcher: false,
      enableScheduler: false,
      executorOverride: async (action, repo) => {
        captured.push({ skill: skillOf(action), args: argsOf(action), repo });
        return {
          action_id: action.action_id, rule_id: action.rule_id,
          skill: skillOf(action), args: argsOf(action),
          started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
          exit_code: 0, stdout_truncated: "",
        };
      },
    });

    await daemon.injectSignal({
      id: "e2e_sig", source: "git", type: "post-commit",
      repo: tmp, timestamp: new Date().toISOString(),
      metadata: { sha: "deadbeef", branch: "main", files: ["src/foo.ts"] },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(captured.length).toBe(1);
    expect(captured[0].skill).toBe("/review");
    expect(captured[0].args).toEqual(["--quick"]);
    expect(captured[0].repo).toBe(tmp);

    await daemon.stop();
  });

  test("post-commit signal on docs/** does NOT trigger /review", async () => {
    const captured: ResolvedAction[] = [];
    const daemon = await startDaemon({
      repos: [tmp],
      socketPath: null,
      enableFileWatcher: false,
      enableScheduler: false,
      executorOverride: async (action) => {
        captured.push(action);
        return {
          action_id: action.action_id, rule_id: action.rule_id,
          skill: skillOf(action), args: argsOf(action),
          started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
          exit_code: 0, stdout_truncated: "",
        };
      },
    });

    await daemon.injectSignal({
      id: "e2e_sig_2", source: "git", type: "post-commit",
      repo: tmp, timestamp: new Date().toISOString(),
      metadata: { files: ["docs/readme.md"] },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(captured.length).toBe(0);
    await daemon.stop();
  });

  test("rate limit prevents 4th concurrent action", async () => {
    const captured: ResolvedAction[] = [];
    let resolveHold!: () => void;
    const hold = new Promise<void>(r => { resolveHold = r; });

    const daemon = await startDaemon({
      repos: [tmp],
      socketPath: null,
      enableFileWatcher: false,
      enableScheduler: false,
      maxConcurrent: 3,
      executorOverride: async (action) => {
        captured.push(action);
        await hold;
        return {
          action_id: action.action_id, rule_id: action.rule_id,
          skill: skillOf(action), args: argsOf(action),
          started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
          exit_code: 0, stdout_truncated: "",
        };
      },
    });

    // Fire 4 signals concurrently; only 3 should reach the executor.
    // We deliberately do NOT await the injectSignal promises here because three
    // of them park inside the executor on `hold`; awaiting before release would
    // deadlock. We await daemon.stop() after releasing the hold to drain.
    const signals = Array.from({ length: 4 }, (_, i) => ({
      id: `e2e_${i}`, source: "git" as const, type: "post-commit",
      repo: tmp, timestamp: new Date().toISOString(),
      metadata: { files: ["src/x.ts"] },
    }));
    const inflight = signals.map(s => daemon.injectSignal(s));

    // Yield long enough for all four handleSignal calls to attempt limiter.tryAcquire.
    await new Promise(r => setTimeout(r, 50));

    expect(captured.length).toBeLessThanOrEqual(3);
    expect(captured.length).toBe(3); // tighter: limiter is set to 3, so exactly 3 should run

    resolveHold();
    await Promise.all(inflight);
    await daemon.stop();
  });
});
