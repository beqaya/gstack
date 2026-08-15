---
name: unfreeze
version: 0.1.0
description: Clear the freeze boundary set by /freeze, allowing edits to all directories again. (gstack)
triggers:
  - unfreeze edits
  - unlock all directories
  - remove edit restrictions
allowed-tools:
  - Bash
  - Read
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->


## When to invoke this skill

Use when you want to widen edit scope without ending the session.
Use when asked to "unfreeze", "unlock edits", "remove freeze", or
"allow all edits".

# /unfreeze — Clear Freeze Boundary

Remove the edit restriction set by `/freeze`, allowing edits to all directories.

```bash
mkdir -p ~/.gstack/analytics
echo '{"skill":"unfreeze","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
```

## Clear the boundary

```bash
eval "$(~/.claude/skills/gstack/bin/gstack-paths)"
STATE_DIR="$GSTACK_STATE_ROOT"
if [ -f "$STATE_DIR/freeze-dir.txt" ]; then
  PREV=$(cat "$STATE_DIR/freeze-dir.txt")
  rm -f "$STATE_DIR/freeze-dir.txt"
  echo "Freeze boundary cleared (was: $PREV)."
else
  echo "No freeze boundary was set."
fi
"$HOME/.claude/skills/gstack/bin/gstack-freeze-wire" --remove
echo "Edits are now allowed everywhere."
```

Tell the user the result plainly: the boundary was enforced by a PreToolUse
hook in `~/.claude/settings.json` (added under the existing `Write|Edit`
matcher by `/freeze`'s Setup step), and this step just removed that exact
hook entry — `gstack-freeze-wire --remove` — leaving every other hook
(auto-stash, generated-file guard, and anything unrelated) untouched. This
is idempotent: running `/unfreeze` again when nothing is frozen is a no-op.
To re-freeze, run `/freeze` again — it reinstalls the hook.
