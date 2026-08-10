---
name: guard
version: 0.1.0
description: "Full safety mode: destructive command warnings + directory-scoped edits. (gstack)"
triggers:
  - full safety mode
  - guard against mistakes
  - maximum safety
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash $HOME/.claude/skills/gstack/careful/bin/check-careful.sh"
          statusMessage: "Checking for destructive commands..."
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


## When to invoke this skill

Combines /careful (warns before rm -rf, DROP TABLE, force-push, etc.) with
/freeze (blocks edits outside a specified directory). Use for maximum safety
when touching prod or debugging live systems. Use when asked to "guard mode",
"full safety", "lock it down", or "maximum safety". Only fires on "full"/
"maximum"/"lock down" phrasing — bare "safety mode" should route to /careful
alone.

# /guard — Full Safety Mode

Activates both destructive command warnings and directory-scoped edit restrictions.
This is the combination of `/careful` + `/freeze` in a single command.

**Enforcement status — the two halves are NOT equivalent:**
- **Edit boundary (`/freeze` half) is tool-enforced.** Setup below installs a
  real PreToolUse hook into `~/.claude/settings.json` via
  `gstack-freeze-wire --install`. Edit/Write outside the boundary is
  **blocked** by the tool layer, not just warned about.
- **Destructive command warnings (`/careful` half) are guidance only, not
  enforced.** No hook is registered for the `Bash` matcher in this
  installation — see `/careful`'s SKILL.md for the full explanation. The
  assistant is expected to check Bash commands against `/careful`'s pattern
  table and warn before running a match, but nothing at the tool layer
  stops the command if that check is skipped.

**Dependency note:** This skill references hook scripts from the sibling `/careful`
and `/freeze` skill directories. Both must be installed (they are installed together
by the gstack setup script).

```bash
mkdir -p ~/.gstack/analytics
echo '{"skill":"guard","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
```

## Setup

Ask the user which directory to restrict edits to. Use AskUserQuestion:

- Question: "Guard mode: which directory should edits be restricted to? (Destructive-command warnings are guidance the assistant follows, not a hook — the edit boundary is the enforced half.) Files outside the chosen path will be blocked from editing."
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

3. Wire the enforcement hook — this is what actually makes the edit boundary
block edits, not just record state nothing reads:
```bash
"$HOME/.claude/skills/gstack/bin/gstack-freeze-wire" --install
```

Tell the user:
- "**Guard mode active.** Two protections are now running:"
- "1. **Destructive command warnings** (guidance, not enforced) — I will check rm -rf, DROP TABLE, force-push, etc. against the pattern table before running them and ask first; this is not a tool-level block, see `/careful` for details."
- "2. **Edit boundary** (enforced) — file edits restricted to `<path>/`, via a real PreToolUse hook registered in `~/.claude/settings.json` (appended into the existing `Write|Edit` matcher alongside your other hooks). Edits outside this directory are blocked."
- "To remove the edit boundary, run `/unfreeze` (or `gstack-freeze-wire --remove` directly). Ending the session does NOT remove it — the hook lives in `~/.claude/settings.json`, not session state, so a forgotten guard stays enforced next session too until `/unfreeze` is run. The destructive-command warnings have no persistent state; they simply stop once the assistant is no longer following `/careful`'s instructions (e.g. a session where `/guard`/`/careful` wasn't invoked)."

## What's protected

See `/careful` for the full list of destructive-command patterns the
assistant checks (guidance only, not enforced) and safe exceptions.
See `/freeze` for how the edit-boundary enforcement works (the tool-enforced half).

## How it works

`/guard`'s Setup installs the exact same enforcement hook `/freeze`
installs: `gstack-freeze-wire --install` appends a PreToolUse entry for
`check-freeze.sh` into the settings.json `Write|Edit` matcher, alongside
the auto-stash and generated-file-guard hooks already there. That is the
only real hook `/guard` wires. The destructive-command half has no
equivalent script wired into settings.json — no `check-careful.sh` hook
exists in `~/.claude/settings.json` — so it works purely by the assistant
following `/careful`'s instructions for the rest of the session.

## Teardown

- `/unfreeze` (or `gstack-freeze-wire --remove` directly) removes the
  edit-boundary hook entry from `~/.claude/settings.json` and clears the
  `freeze-dir.txt` state file. This is the only piece of `/guard` that
  persists outside session memory and needs explicit removal.
- The destructive-command guidance has no persistent state to remove —
  it isn't backed by a hook, so there is nothing in settings.json to undo.
