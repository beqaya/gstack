# Fork delta — beqaya/gstack

This install is a customized fork of garrytan/gstack. `VERSION` and `CHANGELOG.md`
track upstream releases only; this file documents what the fork adds on top, so the
delta survives upstream merges without CHANGELOG conflicts.

Upgrade procedure: merge `upstream/main`, never `git reset --hard`. Full steps in
the auto-memory note `gstack-fork-upgrade` and the /gstack-safe-upgrade skill.

## Fork capabilities (on top of upstream v1.64.0.0, merged 2026-08-15)

- **Frontmatter routing** — `bin/gstack-route` resolves plain-language intents to
  skills from `triggers:`/`voice-triggers:` frontmatter across the gstack and
  cyberteam suites. Coverage pinned by `test/route.test.ts` (15 deliberately
  unrouted cyberteam skills, founder call). `--scan` finds phrases inside real
  sentences; `bin/gstack-route-hint` (UserPromptSubmit hook) surfaces the match
  each prompt.
- **Skill-usage instrumentation** — PostToolUse hook `bin/gstack-skill-usage`
  records real skill invocations to `~/.gstack/analytics/skill-usage.jsonl`.
- **Context census** — `bin/gstack-context-census` attributes where a session's
  tokens actually go (finding: round trips dominate, not payload size).
- **Improvement loop** — `bin/gstack-improve` turns measurements into work items
  under `~/.gstack/runs/<id>/` (sub-project B).
- **Session tooling** — `bin/gstack-sessions` (name/tag/compaction count),
  `bin/gstack-prompt-log` (fsync per prompt), `bin/gstack-thread` (subject
  continuity across sessions + double-clickable launchers).
- **Safe upgrade** — /gstack-safe-upgrade (merge-based, replaces upstream's
  reset-based /gstack-upgrade for this install).
- **Generated-file edit guard** — PreToolUse hook `bin/gstack-generated-guard`
  denies direct edits to generated SKILL.md files; single-use sentinel override
  (`~/.gstack/.allow-generated-edit`), logged to analytics.
- **Failure circuit breaker** — `bin/gstack-failure-count` +
  `references/failure-circuit-breaker.md` (BREAK at 3 same-action failures).
- **Windows fixes** — copy-not-symlink install handling, `linkOrCopySync` test
  helper, portable `gstack-json`, hook timeouts, `.exe`-first binary resolution.
- **Onboarding deferral** — `~/.gstack/.onboarding-deferred` sentinel gates
  onboarding/telemetry prompts ("Boil the Lake" wording is intentional; keep it
  on merge conflicts).

## Branch map

- `custom/frontmatter-routing` — the live line; contains everything above,
  including `windows-fixes-and-enhancements` (merged 2026-08-15).
- `observe-phase1`, `synth-phase1`, `watch-phase1` — WIP runtime/observability
  work in worktrees under `~/dev/gstack-worktrees/`, idle since May 2026.
- `feat/force-multiplier-a1-a3` — WIP.
- `backup/*`, `backup-pre-*` — pre-merge snapshots, keep.
