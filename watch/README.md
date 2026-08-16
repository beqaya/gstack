# gstack-watch

Turns git signals into gstack skill invocations. No daemon: git hooks drop one
JSON event file per commit/merge into an inbox directory, and `gstack-watch
drain` processes the backlog in a single pass — rules engine resolves actions,
the limiter caps them, the executor runs them through Claude Code headless.

## Runtime requirements

- **Bun** (>=1.0) — the CLI and drain execute TypeScript directly via `bun`.
- **`claude` CLI** on PATH (or `GSTACK_CLAUDE_BIN` env override) — the executor
  invokes Claude Code in headless mode (`claude -p --output-format json`) to run
  skills. If `claude` is not present, `auto-run` actions fail with an error
  result and the event file stays in the inbox for the next drain pass.
- **Git Bash** for the hooks (standard with Git for Windows) — the generated
  hook is a POSIX shell script; no `nc`, no socket, no daemon.

### Environment overrides

| Variable | Purpose | Default |
|---|---|---|
| `GSTACK_HOME` | Root of gstack state (inbox/dead/log live under `$GSTACK_HOME/watch/`) | `~/.gstack` |
| `GSTACK_CLAUDE_BIN` | Path to the `claude` binary used by the executor | resolves `claude` from PATH |

## Usage

```bash
bun ~/.claude/skills/gstack/bin/gstack-watch install-hooks [/path/to/repo]   # default: cwd
bun ~/.claude/skills/gstack/bin/gstack-watch drain                            # one pass over the inbox, then exit
bun ~/.claude/skills/gstack/bin/gstack-watch status [--limit N]               # inbox/dead counts + action log tail
bun ~/.claude/skills/gstack/bin/gstack-watch uninstall-hooks [/path/to/repo]
```

## Transport: inbox files

`install-hooks` writes `post-commit` and `post-merge` hooks (backing up any
existing user hook to `<hook>.gstack.bak`; `uninstall-hooks` restores it). On
each commit/merge the hook:

1. Collects repo, SHA, branch, and changed files from git.
2. Builds a one-line JSON signal payload.
3. Writes it atomically into `~/.gstack/watch/inbox/` — temp file
   (`.tmp-<ts>-<pid>`) then rename to `<timestamp>-<pid>.json`. The hook never
   fails the git command; if the inbox is unwritable it exits 0 silently.

`drain` reads the inbox oldest-first, parses each file into a signal, evaluates
it against the rules, and runs resolved `auto-run` actions through the
limiter (default: 3 concurrent-equivalent, 30/hour/repo) and executor. Results
append to `~/.gstack/watch/log/<date>.jsonl`.

Per-file outcome:

- **processed** — actions completed (any exit code); file deleted.
- **deferred** — executor-level failure (spawn error, timeout) or rate limit
  hit; file stays in the inbox and is retried on the next `drain`.
- **poisoned** — unparseable JSON; file moves to `~/.gstack/watch/dead/` so a
  poison file can never wedge the drain.

There is no resident process. Run `drain` manually, from a scheduled task, or
wire it into a session-start hook.

## Default rules

| Rule id | Signal | Action | Notify |
|---|---|---|---|
| `quick-review-on-commit` | git post-commit on `src/**` or `lib/**` | auto-run `/review --quick` | terminal-only-on-finding |
| `daily-health` | daily signal (no producer wired) | auto-run `/health` | terminal |
| `investigate-on-ci-fail` | CI check failure (no producer wired) | auto-run `/investigate --from-ci` | terminal+system |

## Known limits

- Only git hooks produce signals today. The `time` and `ci` rules are
  registered but inert — nothing writes those event files yet (a cron or CI
  step could drop them into the inbox in the same JSON shape).
- Repo state predicates (`branch.age`, `branch.has_diff`, `branch.is_default`)
  evaluate against safe hardcoded defaults; a proper git inspection helper is
  still TODO.
- Root commits report an empty `files` list (`git diff-tree HEAD` prints
  nothing without `--root`), so file-matched rules skip the very first commit
  of a repo.
- Rate-limit state is in-memory per drain pass; the 30/hour cap resets between
  passes (deferred files still carry over via the inbox).
