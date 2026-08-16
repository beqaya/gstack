import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installGitHooks, uninstallGitHooks, assertSafeInboxPath } from "../src/signals/git-hooks";

describe("git hooks installer (inbox transport)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "repo-"));
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  test("installs post-commit and post-merge hooks", async () => {
    await installGitHooks(repo, "/tmp/inbox");
    expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(true);
    expect(existsSync(join(repo, ".git", "hooks", "post-merge"))).toBe(true);
  });

  test("installed hook writes to the inbox dir, atomically, and never uses nc", async () => {
    await installGitHooks(repo, "/tmp/inbox");
    const body = readFileSync(readHookPath(repo), "utf8");
    expect(body).toContain('INBOX="/tmp/inbox"');
    expect(body).toContain("gstack-watch");
    // atomic write: temp file then rename into place
    expect(body).toContain('mkdir -p "$INBOX"');
    expect(body).toContain("$INBOX/.tmp-");
    expect(body).toMatch(/mv -f "\$TMP"/);
    // unique final filename: timestamp + pid, .json extension
    expect(body).toContain('.json"');
    expect(body).toContain("$$");
    // the dead transport is gone
    expect(body).not.toContain("nc -U");
    expect(body).not.toMatch(/\bSOCKET\b/);
  });

  test("Windows inbox paths are interpolated with forward slashes", async () => {
    await installGitHooks(repo, "C:\\Users\\someone\\.gstack\\watch\\inbox");
    const body = readFileSync(readHookPath(repo), "utf8");
    expect(body).toContain('INBOX="C:/Users/someone/.gstack/watch/inbox"');
  });

  test("defaults to the watchInboxDir() when no inbox dir is given", async () => {
    await installGitHooks(repo);
    const body = readFileSync(readHookPath(repo), "utf8");
    expect(body).toMatch(/INBOX=".*watch\/inbox"/);
  });

  test("uninstall removes hooks", async () => {
    await installGitHooks(repo, "/tmp/inbox");
    await uninstallGitHooks(repo);
    expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(false);
  });

  test("preserves existing user hook via backup", async () => {
    const userHook = "#!/bin/sh\necho user-custom-hook\n";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo, ".git", "hooks", "post-commit"), userHook);
    await installGitHooks(repo, "/tmp/inbox");
    expect(existsSync(join(repo, ".git", "hooks", "post-commit.gstack.bak"))).toBe(true);
    expect(readFileSync(join(repo, ".git", "hooks", "post-commit.gstack.bak"), "utf8")).toBe(userHook);
  });

  test("uninstall restores backed-up user hook", async () => {
    const userHook = "#!/bin/sh\necho user-custom-hook\n";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo, ".git", "hooks", "post-commit"), userHook);
    await installGitHooks(repo, "/tmp/inbox");
    await uninstallGitHooks(repo);
    expect(readFileSync(join(repo, ".git", "hooks", "post-commit"), "utf8")).toBe(userHook);
  });

  test("hook body JSON-escapes backslashes for Windows repo paths", async () => {
    await installGitHooks(repo, "/tmp/inbox");
    const body = readFileSync(readHookPath(repo), "utf8");
    expect(body).toContain("json_escape");
    expect(body).toContain("REPO_E=");
  });
});

function readHookPath(repo: string): string {
  return join(repo, ".git", "hooks", "post-commit");
}

describe("assertSafeInboxPath", () => {
  test("accepts standard Unix path", () => {
    expect(() => assertSafeInboxPath("/home/u/.gstack/watch/inbox")).not.toThrow();
  });
  test("accepts Windows path with backslashes", () => {
    expect(() => assertSafeInboxPath("C:\\Users\\u\\.gstack\\watch\\inbox")).not.toThrow();
  });
  test("accepts path with dashes, dots, underscores", () => {
    expect(() => assertSafeInboxPath("/var/run/gstack-watch_v2.inbox")).not.toThrow();
  });
  test("rejects double-quote (would break out of shell string)", () => {
    expect(() => assertSafeInboxPath('/tmp/a"; rm -rf /; "')).toThrow(/unsafe inbox path/);
  });
  test("rejects dollar sign (variable expansion / command substitution)", () => {
    expect(() => assertSafeInboxPath("/tmp/$(rm -rf /).inbox")).toThrow(/unsafe/);
  });
  test("rejects backtick (command substitution)", () => {
    expect(() => assertSafeInboxPath("/tmp/`whoami`.inbox")).toThrow(/unsafe/);
  });
  test("rejects embedded newline", () => {
    expect(() => assertSafeInboxPath("/tmp/inbox\nrm -rf /")).toThrow(/unsafe/);
  });
  test("rejects NUL byte", () => {
    expect(() => assertSafeInboxPath("/tmp/a\0inbox")).toThrow(/unsafe/);
  });
});

describe("installGitHooks validates inbox path", () => {
  let repo2: string;
  beforeEach(() => {
    repo2 = mkdtempSync(join(tmpdir(), "repo2-"));
    mkdirSync(join(repo2, ".git", "hooks"), { recursive: true });
  });
  afterEach(() => { rmSync(repo2, { recursive: true, force: true }); });

  test("refuses to install when inbox path contains shell metacharacters", async () => {
    await expect(installGitHooks(repo2, '/tmp/x"; touch pwned; "')).rejects.toThrow(/unsafe inbox path/);
    expect(existsSync(join(repo2, ".git", "hooks", "post-commit"))).toBe(false);
  });
});
