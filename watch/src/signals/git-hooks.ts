import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOOKS = ["post-commit", "post-merge"] as const;

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
PAYLOAD=$(printf '{"source":"git","type":"%s","repo":"%s","metadata":{"sha":"%s","branch":"%s","files":"%s"}}\\n' "$HOOK" "$REPO" "$SHA" "$BRANCH" "$FILES")

# Try Unix socket via nc; fall back to silently dropping if unavailable.
if command -v nc >/dev/null 2>&1; then
  printf '%s' "$PAYLOAD" | nc -U "$SOCKET" -w 1 2>/dev/null || true
fi
exit 0
`;
}

export async function installGitHooks(repoRoot: string, socketPath: string): Promise<void> {
  const hooksDir = join(repoRoot, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });
  for (const h of HOOKS) {
    const path = join(hooksDir, h);
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
  }
}
