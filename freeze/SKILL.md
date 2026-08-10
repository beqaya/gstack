---
name: freeze
version: 0.1.0
description: |
  Restrict file edits to a specific directory for the session. Blocks Edit and
  Write outside the allowed path. Use when debugging to prevent accidentally
  "fixing" unrelated code, or when you want to scope changes to one module.
  Use when asked to "freeze", "restrict edits", "only edit this folder",
  or "lock down edits". (gstack)
triggers:
  - freeze edits to directory
  - lock editing scope
  - restrict file changes
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
hooks:
  PreToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bash $HOME/.claude/skills/gstack/freeze/bin/check-freeze.sh"
          statusMessage: "Checking freeze boundary..."
    - matcher: "Write"
      hooks:
        - type: command
          command: "bash $HOME/.claude/skills/gstack/freeze/bin/check-freeze.sh"
          statusMessage: "Checking freeze boundary..."
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

# /freeze — Restrict Edits to a Directory

Lock file edits to a specific directory. Any Edit or Write operation targeting
a file outside the allowed path will be **blocked** (not just warned).

```bash
mkdir -p ~/.gstack/analytics
echo '{"skill":"freeze","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
```

## Setup

Ask the user which directory to restrict edits to. Use AskUserQuestion:

- Question: "Which directory should I restrict edits to? Files outside this path will be blocked from editing."
- Text input (not multiple choice) — the user types a path.

Once the user provides a directory path:

1. Resolve it to an absolute path:
```bash
FREEZE_DIR=$(cd "<user-provided-path>" 2>/dev/null && pwd)
echo "$FREEZE_DIR"
```

2. Ensure trailing slash and save to the freeze state file:
```bash
FREEZE_DIR="${FREEZE_DIR%/}/"
eval "$(~/.claude/skills/gstack/bin/gstack-paths)"
STATE_DIR="$GSTACK_STATE_ROOT"
mkdir -p "$STATE_DIR"
echo "$FREEZE_DIR" > "$STATE_DIR/freeze-dir.txt"
echo "Freeze boundary set: $FREEZE_DIR"
```

3. Wire the enforcement hook — this is what actually makes the boundary
block edits, not just record state nothing reads:
```bash
"$HOME/.claude/skills/gstack/bin/gstack-freeze-wire" --install
```

Tell the user: "Edits are now restricted to `<path>/`, enforced by a
PreToolUse hook registered in `~/.claude/settings.json` (appended into the
existing `Write|Edit` matcher alongside your other hooks — nothing else was
touched). Any Edit or Write outside this directory will be blocked. To
change the boundary, run `/freeze` again. To remove the boundary AND the
hook, run `/unfreeze` (or `gstack-freeze-wire --remove` directly)."

## How it works

`/freeze`'s Setup step installs the enforcement hook via
`gstack-freeze-wire --install`, which appends a PreToolUse entry for
`check-freeze.sh` into the settings.json `Write|Edit` matcher that already
carries the auto-stash and generated-file-guard hooks — it is one more hook
in that same list, not a separate matcher entry. Without this step nothing
ever invokes the script and the boundary is inert.

The hook reads `file_path` from the Edit/Write tool input JSON, then checks
whether the path starts with the freeze directory. If not, it returns
`permissionDecision: "deny"` to block the operation.

The freeze boundary persists across sessions via the state file
(`freeze-dir.txt`) AND the settings.json hook entry — both survive until
`/unfreeze` removes them. The hook script reads the state file on every
Edit/Write invocation.

## Notes

- The trailing `/` on the freeze directory prevents `/src` from matching `/src-old`
- Freeze applies to Edit and Write tools only — Read, Bash, Glob, Grep are unaffected
- This prevents accidental edits, not a security boundary — Bash commands like `sed` can still modify files outside the boundary
- The boundary is enforced by a real settings.json PreToolUse hook, not just session state — it survives until explicitly removed
- To deactivate, run `/unfreeze` — this removes both the state file and the
  settings.json hook entry. Ending the session does NOT remove the hook
  entry (it lives in `~/.claude/settings.json`, not session memory), so a
  forgotten freeze stays enforced in your NEXT session too until `/unfreeze`
  is run
