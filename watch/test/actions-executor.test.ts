import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutor } from "../src/actions/executor";
import type { ResolvedAction } from "../src/rules/engine";

describe("action executor", () => {
  let logDir: string;
  beforeEach(() => { logDir = mkdtempSync(join(tmpdir(), "exec-")); });
  afterEach(() => { rmSync(logDir, { recursive: true, force: true }); });

  test("captures stdout and exit_code from successful subprocess", async () => {
    const exec = createExecutor({
      skillRunner: async (skill, args) => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      logDir,
    });
    const action: ResolvedAction = {
      action_id: "a1", rule_id: "r1", signal_id: "s1",
      action: { type: "auto-run", skill: "/health" },
      notify: "terminal",
      resolved_at: new Date().toISOString(),
    };
    const result = await exec.run(action, "/repo");
    expect(result.exit_code).toBe(0);
    expect(result.stdout_truncated).toContain("ok");
  });

  test("records error when subprocess throws", async () => {
    const exec = createExecutor({
      skillRunner: async () => { throw new Error("boom"); },
      logDir,
    });
    const action: ResolvedAction = {
      action_id: "a2", rule_id: "r1", signal_id: "s1",
      action: { type: "auto-run", skill: "/health" },
      notify: "terminal",
      resolved_at: new Date().toISOString(),
    };
    const result = await exec.run(action, "/repo");
    expect(result.exit_code).toBe(-1);
    expect(result.error).toContain("boom");
  });

  test("truncates very large stdout to 64KB", async () => {
    const big = "x".repeat(100_000);
    const exec = createExecutor({
      skillRunner: async () => ({ exitCode: 0, stdout: big, stderr: "" }),
      logDir,
    });
    const action: ResolvedAction = {
      action_id: "a3", rule_id: "r1", signal_id: "s1",
      action: { type: "auto-run", skill: "/health" },
      notify: "terminal",
      resolved_at: new Date().toISOString(),
    };
    const result = await exec.run(action, "/repo");
    expect(result.stdout_truncated.length).toBeLessThanOrEqual(64 * 1024 + 50); // +trail marker
  });
});
