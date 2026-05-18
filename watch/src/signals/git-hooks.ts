import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOOKS = ["post-commit", "post-merge"] as const;

/**
 * Validate a socket path before interpolating into a shell hook script.
 * Rejects characters that would let an attacker (or accidental config) break
 * out of the shell double-quoted SOCKET="..." context: ", $, `, and newlines.
 * Backslash is permitted (Windows named-pipe paths contain it; Windows hook
 * path is currently unused but we don't want to break it for Phase 2).
 */
export function assertSafeSocketPath(socketPath: string): void {
  // eslint-disable-next-line no-control-regex
  const forbidden = /["$`\r\n\x00]/;
  if (forbidden.test(socketPath)) {
    throw new Error(
      `unsafe socket path: contains shell metacharacters that would break out of the hook script (\", $, \`, NUL, or newline): ${JSON.stringify(socketPath)}`,
    );
  }
}

function hookBody(socketPath: string, hookName: string): string {
  // POSIX shell script; Git on Windows runs hooks under Git Bash, so this works cross-platform.
  return `#!/usr/bin/env bash
# Installed by gstack-watch — do not edit manually.
SOCKET="${socketPath}"
HOOK="${hookName}"
REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
SHA="$(git rev-parse HEAD 2>/dev/null)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
FILES="$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | tr '\\n' ',' | sed 's/,$//')"

json_escape() {
  printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'
}

REPO_E=$(json_escape "$REPO")
SHA_E=$(json_escape "$SHA")
BRANCH_E=$(json_escape "$BRANCH")
FILES_E=$(json_escape "$FILES")

PAYLOAD=$(printf '{"source":"git","type":"%s","repo":"%s","metadata":{"sha":"%s","branch":"%s","files":"%s"}}\\n' "$HOOK" "$REPO_E" "$SHA_E" "$BRANCH_E" "$FILES_E")

# Try Unix socket via nc; fall back to silently dropping if unavailable.
# TODO(T14): on Windows where nc is unavailable, write to ~/.gstack/watch/inbox/<ts>-<pid>.json instead.
if command -v nc >/dev/null 2>&1; then
  printf '%s' "$PAYLOAD" | nc -U -w 1 "$SOCKET" 2>/dev/null || true
fi
exit 0
`;
}

async function isGstackHook(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(path, "utf8");
  return body.includes("# Installed by gstack-watch");
}

export async function installGitHooks(repoRoot: string, socketPath: string): Promise<void> {
  assertSafeSocketPath(socketPath);
  const hooksDir = join(repoRoot, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });
  for (const h of HOOKS) {
    const path = join(hooksDir, h);
    if (existsSync(path) && !(await isGstackHook(path))) {
      const backup = `${path}.gstack.bak`;
      const { rename } = await import("node:fs/promises");
      await rename(path, backup);
    }
    await writeFile(path, hookBody(socketPath, h), { encoding: "utf8" });
    if (process.platform !== "win32") {
      await chmod(path, 0o755);
    }
  }
}

export async function uninstallGitHooks(repoRoot: string): Promise<void> {
  const hooksDir = join(repoRoot, ".git", "hooks");
  for (const h of HOOKS) {
    const path = join(hooksDir, h);
    if (existsSync(path)) {
      await rm(path);
    }
    const backup = `${path}.gstack.bak`;
    if (existsSync(backup)) {
      const { rename } = await import("node:fs/promises");
      await rename(backup, path);
    }
  }
}
