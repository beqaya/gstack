import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { watchInboxDir } from "../paths";

const HOOKS = ["post-commit", "post-merge"] as const;

/**
 * Validate the inbox directory path before interpolating into a shell hook
 * script. Rejects characters that would let an attacker (or accidental config)
 * break out of the shell double-quoted INBOX="..." context: ", $, `, and
 * newlines. Backslash is permitted (Windows paths contain it; the generator
 * converts to forward slashes for Git Bash before interpolation).
 */
export function assertSafeInboxPath(inboxDir: string): void {
  // eslint-disable-next-line no-control-regex
  const forbidden = /["$`\r\n\x00]/;
  if (forbidden.test(inboxDir)) {
    throw new Error(
      `unsafe inbox path: contains shell metacharacters that would break out of the hook script (\", $, \`, NUL, or newline): ${JSON.stringify(inboxDir)}`,
    );
  }
}

function hookBody(inboxDir: string, hookName: string): string {
  // POSIX shell script; Git on Windows runs hooks under Git Bash, so this works
  // cross-platform. Windows drive paths are pre-converted to forward slashes
  // (C:/Users/...) — Git Bash handles those natively.
  const inboxPosix = inboxDir.replace(/\\/g, "/");
  return `#!/usr/bin/env bash
# Installed by gstack-watch — do not edit manually.
INBOX="${inboxPosix}"
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

PAYLOAD=$(printf '{"source":"git","type":"%s","repo":"%s","metadata":{"sha":"%s","branch":"%s","files":"%s"}}' "$HOOK" "$REPO_E" "$SHA_E" "$BRANCH_E" "$FILES_E")

# Inbox-file transport: drop one JSON event file, atomically (temp + rename).
# A later \`gstack-watch drain\` pass picks it up. Never fail the git command.
mkdir -p "$INBOX" 2>/dev/null || exit 0
TS="$(date +%s%N 2>/dev/null || date +%s)"
TMP="$INBOX/.tmp-\${TS}-$$"
printf '%s\\n' "$PAYLOAD" > "$TMP" 2>/dev/null || { rm -f "$TMP" 2>/dev/null; exit 0; }
mv -f "$TMP" "$INBOX/\${TS}-$$.json" 2>/dev/null || rm -f "$TMP" 2>/dev/null
exit 0
`;
}

async function isGstackHook(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(path, "utf8");
  return body.includes("# Installed by gstack-watch");
}

export async function installGitHooks(repoRoot: string, inboxDir: string = watchInboxDir()): Promise<void> {
  assertSafeInboxPath(inboxDir);
  const hooksDir = join(repoRoot, ".git", "hooks");
  await mkdir(hooksDir, { recursive: true });
  for (const h of HOOKS) {
    const path = join(hooksDir, h);
    if (existsSync(path) && !(await isGstackHook(path))) {
      const backup = `${path}.gstack.bak`;
      const { rename } = await import("node:fs/promises");
      await rename(path, backup);
    }
    await writeFile(path, hookBody(inboxDir, h), { encoding: "utf8" });
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
