---
name: careful
version: 0.1.0
description: Safety guardrails for destructive commands. (gstack)
triggers:
  - be careful
  - warn before destructive
  - safety mode
allowed-tools:
  - Bash
  - Read
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash $HOME/.claude/skills/gstack/careful/bin/check-careful.sh"
          statusMessage: "Checking for destructive commands..."
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->


## When to invoke this skill

Warns before rm -rf, DROP TABLE,
force-push, git reset --hard, kubectl delete, and similar destructive operations.
User can override each warning. Use when touching prod, debugging live systems,
or working in a shared environment. Use when asked to "be careful", "safety mode",
"prod mode", or "careful mode".

# /careful — Destructive Command Guardrails (guidance only, not enforced)

**Enforcement status: this skill is guidance, not a tool-level block.** The
`hooks:` block in this file's frontmatter is declarative only — this harness
does not auto-register frontmatter hooks (gstack is not an enabled plugin
here; see `enabledPlugins` in `~/.claude/settings.json`), so
`check-careful.sh` is never invoked automatically and no Bash call is
actually intercepted. Nothing currently wires it into `~/.claude/settings.json`
the way `/freeze` wires `check-freeze.sh` (via `gstack-freeze-wire`).

In practice, "safety mode" means the assistant is expected to read the
pattern table below and check each Bash command against it before running,
warning you and waiting for confirmation on a match. That is a convention
the assistant follows, not a guarantee — there is no mechanism stopping the
assistant (or any other code path) from running a matching command without
checking. For a real, tool-enforced boundary see `/freeze`, which blocks
Edit/Write outside a directory via an actual PreToolUse hook.

```bash
mkdir -p ~/.gstack/analytics
echo '{"skill":"careful","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
```

## Patterns the assistant checks for

Not "protected" in the enforced sense — these are the patterns the
assistant is expected to recognize and warn about, per the guidance above.

| Pattern | Example | Risk |
|---------|---------|------|
| `rm -rf` / `rm -r` / `rm --recursive` | `rm -rf /var/data` | Recursive delete |
| `DROP TABLE` / `DROP DATABASE` | `DROP TABLE users;` | Data loss |
| `TRUNCATE` | `TRUNCATE orders;` | Data loss |
| `git push --force` / `-f` | `git push -f origin main` | History rewrite |
| `git reset --hard` | `git reset --hard HEAD~3` | Uncommitted work loss |
| `git checkout .` / `git restore .` | `git checkout .` | Uncommitted work loss |
| `kubectl delete` | `kubectl delete pod` | Production impact |
| `docker rm -f` / `docker system prune` | `docker system prune -a` | Container/image loss |

## Safe exceptions

These patterns are allowed without warning:
- `rm -rf node_modules` / `.next` / `dist` / `__pycache__` / `.cache` / `build` / `.turbo` / `coverage`

## How it works

`bin/check-careful.sh` exists and, if it were wired into
`~/.claude/settings.json` (the same way `gstack-freeze-wire` wires
`check-freeze.sh` for `/freeze`), would read the command from the tool
input JSON, check it against the patterns above, and return
`permissionDecision: "ask"` with a warning message on a match. That wiring
has not been done — no `bin/gstack-careful-wire` (or equivalent) exists,
and `~/.claude/settings.json` has no `PreToolUse` entry for the `Bash`
matcher. So today the script only runs if you invoke it yourself; it is
never triggered by the harness.

What actually happens when you run `/careful` is that the assistant reads
this file and follows it as instructions for the rest of the session: check
each Bash command it's about to run against the table above, and ask before
running a match. There is no hook to deactivate — this ends when the
assistant stops following the instruction (end of session, or if it's
simply not adhered to).
