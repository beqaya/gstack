# gstack-watch

Autonomous daemon that turns git/file/schedule signals into gstack skill invocations. Phase 1 of the `gstack-watch-v1` design.

## Runtime requirements

- **Bun** (>=1.0) — the daemon and its supervisor execute TypeScript directly via `bun`. The supervisor spawns `bun watch/src/cli/start.ts --worker`; pure Node cannot run this without a transpile step.
- **`claude` CLI** on PATH (or `GSTACK_CLAUDE_BIN` env override) — the executor invokes Claude Code in headless mode (`claude -p --output-format json`) to run skills. If `claude` is not present, `auto-run` actions will fail; signal capture and logging still work.

### Environment overrides

| Variable | Purpose | Default |
|---|---|---|
| `GSTACK_CLAUDE_BIN` | Path to the `claude` binary used by the executor | resolves `claude` from PATH |
| `GSTACK_WATCH_BUN_BIN` | Path to the `bun` binary used by the supervisor to spawn the worker | resolves `bun` from PATH |
| `GSTACK_WATCH_WORKER` | Set to `1` automatically by the supervisor when spawning the worker; do not set manually | unset |

## Usage

```bash
bun ~/.claude/skills/gstack/bin/gstack-watch start --repo /path/to/repo
bun ~/.claude/skills/gstack/bin/gstack-watch status
bun ~/.claude/skills/gstack/bin/gstack-watch tail
bun ~/.claude/skills/gstack/bin/gstack-watch stop
```

## Default rules (Phase 1)

| Rule id | Signal | Action | Notify |
|---|---|---|---|
| `quick-review-on-commit` | git post-commit on `src/**` or `lib/**` | auto-run `/review --quick` | terminal-only-on-finding |
| `daily-health` | daily at configured HH:MM (default 09:00) | auto-run `/health` | terminal |
| `investigate-on-ci-fail` | CI check failure (no listener in Phase 1) | auto-run `/investigate --from-ci` | terminal+system |

## Known Phase 1 limits

- Supervisor expects `bun` — no `node` fallback. Track upstream Node TS support (`--experimental-strip-types`) as a future avenue.
- CI signal source is not wired (Phase 2).
- `status` does not persist watched-repos list across daemon restarts.
- Multi-instance: the daemon binds a single fixed socket path. Two daemons on one machine collide. Phase 2 adds per-config socket paths.
- Windows: file watcher and git hooks work under Git Bash; the hook fallback for Windows-without-`nc` (write to `~/.gstack/watch/inbox/`) is a Phase 2 TODO.
