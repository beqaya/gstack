import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installGitHooks, uninstallGitHooks, assertSafeSocketPath } from "../src/signals/git-hooks";

describe("git hooks installer", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "repo-"));
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  test("installs post-commit and post-merge hooks", async () => {
    await installGitHooks(repo, "/tmp/test.sock");
    expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(true);
    expect(existsSync(join(repo, ".git", "hooks", "post-merge"))).toBe(true);
  });

  test("installed hook references the socket path", async () => {
    await installGitHooks(repo, "/tmp/test.sock");
    const body = readFileSync(join(repo, ".git", "hooks", "post-commit"), "utf8");
    expect(body).toContain("/tmp/test.sock");
    expect(body).toContain("gstack-watch");
  });

  test("uninstall removes hooks", async () => {
    await installGitHooks(repo, "/tmp/test.sock");
    await uninstallGitHooks(repo);
    expect(existsSync(join(repo, ".git", "hooks", "post-commit"))).toBe(false);
  });

  test("preserves existing user hook via backup", async () => {
    const userHook = "#!/bin/sh\necho user-custom-hook\n";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo, ".git", "hooks", "post-commit"), userHook);
    await installGitHooks(repo, "/tmp/test.sock");
    expect(existsSync(join(repo, ".git", "hooks", "post-commit.gstack.bak"))).toBe(true);
    expect(readFileSync(join(repo, ".git", "hooks", "post-commit.gstack.bak"), "utf8")).toBe(userHook);
  });

  test("uninstall restores backed-up user hook", async () => {
    const userHook = "#!/bin/sh\necho user-custom-hook\n";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo, ".git", "hooks", "post-commit"), userHook);
    await installGitHooks(repo, "/tmp/test.sock");
    await uninstallGitHooks(repo);
    expect(readFileSync(join(repo, ".git", "hooks", "post-commit"), "utf8")).toBe(userHook);
  });

  test("hook body JSON-escapes backslashes for Windows paths", async () => {
    await installGitHooks(repo, "/tmp/test.sock");
    const body = readFileSync(join(repo, ".git", "hooks", "post-commit"), "utf8");
    expect(body).toContain("json_escape");
    expect(body).toContain("REPO_E=");
  });
});

describe("assertSafeSocketPath", () => {
  test("accepts standard Unix socket path", () => {
    expect(() => assertSafeSocketPath("/tmp/gstack-watch.sock")).not.toThrow();
  });
  test("accepts Windows named-pipe path", () => {
    expect(() => assertSafeSocketPath("\\\\.\\pipe\\gstack-watch")).not.toThrow();
  });
  test("accepts path with dashes, dots, underscores", () => {
    expect(() => assertSafeSocketPath("/var/run/gstack-watch_v2.sock")).not.toThrow();
  });
  test("rejects double-quote (would break out of shell string)", () => {
    expect(() => assertSafeSocketPath('/tmp/a"; rm -rf /; "')).toThrow(/unsafe socket path/);
  });
  test("rejects dollar sign (variable expansion / command substitution)", () => {
    expect(() => assertSafeSocketPath("/tmp/$(rm -rf /).sock")).toThrow(/unsafe/);
  });
  test("rejects backtick (command substitution)", () => {
    expect(() => assertSafeSocketPath("/tmp/`whoami`.sock")).toThrow(/unsafe/);
  });
  test("rejects embedded newline", () => {
    expect(() => assertSafeSocketPath("/tmp/a.sock\nrm -rf /")).toThrow(/unsafe/);
  });
  test("rejects NUL byte", () => {
    expect(() => assertSafeSocketPath("/tmp/a\0.sock")).toThrow(/unsafe/);
  });
});

describe("installGitHooks validates socketPath", () => {
  let repo2: string;
  beforeEach(() => {
    repo2 = mkdtempSync(join(tmpdir(), "repo2-"));
    mkdirSync(join(repo2, ".git", "hooks"), { recursive: true });
  });
  afterEach(() => { rmSync(repo2, { recursive: true, force: true }); });

  test("refuses to install when socketPath contains shell metacharacters", async () => {
    await expect(installGitHooks(repo2, '/tmp/x"; touch pwned; "')).rejects.toThrow(/unsafe socket path/);
    // Hook should NOT have been written.
    expect(existsSync(join(repo2, ".git", "hooks", "post-commit"))).toBe(false);
  });
});
