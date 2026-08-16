import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainInbox, parseInboxSignal } from "../src/drain";
import { watchDeadDir, watchInboxDir } from "../src/paths";
import type { ResolvedAction } from "../src/rules/engine";
import type { ActionResult } from "../src/types";

function okResult(action: ResolvedAction, overrides: Partial<ActionResult> = {}): ActionResult {
  const runnable = action.action.type === "auto-run" || action.action.type === "suggest";
  return {
    action_id: action.action_id, rule_id: action.rule_id,
    skill: runnable ? action.action.skill : "", args: runnable ? action.action.args ?? [] : [],
    started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    exit_code: 0, stdout_truncated: "",
    ...overrides,
  };
}

// Mirror of what the generated git hook writes: files is a comma-joined string.
function hookPayload(files: string, repo: string): string {
  return JSON.stringify({
    source: "git", type: "post-commit", repo,
    metadata: { sha: "deadbeef", branch: "main", files },
  }) + "\n";
}

describe("parseInboxSignal", () => {
  test("normalizes the hook's comma-joined files string into an array", () => {
    const s = parseInboxSignal(hookPayload("src/a.ts,src/b.ts", "/r"));
    expect(s.metadata.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(s.source).toBe("git");
    expect(s.type).toBe("post-commit");
    expect(s.id.startsWith("sig_")).toBe(true);
    expect(typeof s.timestamp).toBe("string");
  });

  test("empty files string becomes empty array", () => {
    const s = parseInboxSignal(hookPayload("", "/r"));
    expect(s.metadata.files).toEqual([]);
  });

  test("throws on non-JSON", () => {
    expect(() => parseInboxSignal("not json {")).toThrow();
  });

  test("throws on missing repo", () => {
    expect(() => parseInboxSignal(JSON.stringify({ source: "git", type: "post-commit" }))).toThrow(/repo/);
  });
});

describe("drainInbox (via GSTACK_HOME override)", () => {
  let home: string;
  let savedHome: string | undefined;
  let inbox: string;
  let dead: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "gstack-home-"));
    savedHome = process.env.GSTACK_HOME;
    process.env.GSTACK_HOME = home;
    inbox = watchInboxDir();
    dead = watchDeadDir();
    mkdirSync(inbox, { recursive: true });
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.GSTACK_HOME;
    else process.env.GSTACK_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("happy path: hook event file resolves /review --quick, file is consumed", async () => {
    writeFileSync(join(inbox, "100-1.json"), hookPayload("src/foo.ts", "/some/repo"));
    const captured: { skill: string; args: string[]; repo: string }[] = [];

    const summary = await drainInbox({
      executorOverride: async (action, repo) => {
        const runnable = action.action.type === "auto-run" || action.action.type === "suggest";
        captured.push({
          skill: runnable ? action.action.skill : "",
          args: runnable ? action.action.args ?? [] : [],
          repo,
        });
        return okResult(action);
      },
    });

    expect(captured.length).toBe(1);
    expect(captured[0].skill).toBe("/review");
    expect(captured[0].args).toEqual(["--quick"]);
    expect(captured[0].repo).toBe("/some/repo");
    expect(summary).toEqual({ scanned: 1, processed: 1, deferred: 0, poisoned: 0 });
    expect(readdirSync(inbox)).toEqual([]);
  });

  test("non-matching signal (docs-only commit) is consumed without running anything", async () => {
    writeFileSync(join(inbox, "100-1.json"), hookPayload("docs/readme.md", "/some/repo"));
    let ran = 0;
    const summary = await drainInbox({
      executorOverride: async (action) => { ran++; return okResult(action); },
    });
    expect(ran).toBe(0);
    expect(summary.processed).toBe(1);
    expect(readdirSync(inbox)).toEqual([]);
  });

  test("poison file moves to dead/, valid files still drain", async () => {
    writeFileSync(join(inbox, "100-1.json"), "this is { not json");
    writeFileSync(join(inbox, "200-2.json"), hookPayload("src/foo.ts", "/some/repo"));
    let ran = 0;

    const summary = await drainInbox({
      executorOverride: async (action) => { ran++; return okResult(action); },
    });

    expect(summary).toEqual({ scanned: 2, processed: 1, deferred: 0, poisoned: 1 });
    expect(ran).toBe(1);
    expect(readdirSync(inbox)).toEqual([]);
    expect(existsSync(join(dead, "100-1.json"))).toBe(true);
  });

  test("executor-level failure leaves the file in the inbox for the next pass", async () => {
    writeFileSync(join(inbox, "100-1.json"), hookPayload("src/foo.ts", "/some/repo"));
    const summary = await drainInbox({
      executorOverride: async (action) =>
        okResult(action, { exit_code: -1, error: "spawn claude ENOENT" }),
    });
    expect(summary).toEqual({ scanned: 1, processed: 0, deferred: 1, poisoned: 0 });
    expect(readdirSync(inbox)).toEqual(["100-1.json"]);
  });

  test("completed run with nonzero exit is consumed (skill outcome, not transport failure)", async () => {
    writeFileSync(join(inbox, "100-1.json"), hookPayload("src/foo.ts", "/some/repo"));
    const summary = await drainInbox({
      executorOverride: async (action) => okResult(action, { exit_code: 2 }),
    });
    expect(summary.processed).toBe(1);
    expect(readdirSync(inbox)).toEqual([]);
  });

  test("in-flight temp files and non-json files are ignored", async () => {
    writeFileSync(join(inbox, ".tmp-123-9"), "partial write");
    writeFileSync(join(inbox, "notes.txt"), "not an event");
    const summary = await drainInbox({
      executorOverride: async (action) => okResult(action),
    });
    expect(summary.scanned).toBe(0);
    expect(readdirSync(inbox).sort()).toEqual([".tmp-123-9", "notes.txt"]);
  });

  test("oldest file drains first", async () => {
    const older = join(inbox, "100-1.json");
    const newer = join(inbox, "200-2.json");
    writeFileSync(older, hookPayload("src/a.ts", "/repo-old"));
    writeFileSync(newer, hookPayload("src/b.ts", "/repo-new"));
    const order: string[] = [];
    await drainInbox({
      executorOverride: async (action, repo) => { order.push(repo); return okResult(action); },
    });
    expect(order).toEqual(["/repo-old", "/repo-new"]);
  });

  test("rate limit defers extra events instead of dropping them", async () => {
    writeFileSync(join(inbox, "100-1.json"), hookPayload("src/a.ts", "/same/repo"));
    writeFileSync(join(inbox, "200-2.json"), hookPayload("src/b.ts", "/same/repo"));
    let ran = 0;
    const summary = await drainInbox({
      maxActionsPerHour: 1,
      executorOverride: async (action) => { ran++; return okResult(action); },
    });
    expect(ran).toBe(1);
    expect(summary).toEqual({ scanned: 2, processed: 1, deferred: 1, poisoned: 0 });
    expect(readdirSync(inbox)).toEqual(["200-2.json"]);
  });

  test("missing inbox dir is a clean no-op", async () => {
    rmSync(inbox, { recursive: true, force: true });
    const summary = await drainInbox({
      executorOverride: async (action) => okResult(action),
    });
    expect(summary).toEqual({ scanned: 0, processed: 0, deferred: 0, poisoned: 0 });
  });
});
