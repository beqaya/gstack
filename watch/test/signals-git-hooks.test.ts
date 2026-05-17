import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installGitHooks, uninstallGitHooks } from "../src/signals/git-hooks";

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
