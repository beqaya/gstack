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

## Absorbed ahead of the full upstream merge

- **skill-start runtime (upstream v1.71.0.0, #2691; cherry-picked 2026-09-12).**
  The ~18 KB of preamble bash every tier-2+ skill inlined now lives in
  `bin/gstack-skill-start` / `bin/gstack-skill-end`; generated skills carry a
  six-line invocation fence. Onboarding prompts are emitted as runtime-gated
  `GSTACK_INSTRUCTION` blocks, so the onboarding-deferral sentinel above is
  honored inside the script (`ONBOARDING_DEFERRED:` STATUS line; lake intro,
  telemetry, proactive and routing gates all check it) and the lake intro
  still says "Boil the Lake". Also brought in: the 20 section carves
  (`<skill>/sections/*.md.tmpl`), `bin/gstack-retro-metrics` behind /retro,
  the `{{CODEX_WEB_SEARCH_FLAG}}` resolver (#2525, every codex invocation now
  uses `-c 'web_search="cached"'`), the context-budget ratchet, and the
  `preamble-tier` requirement (every template that resolves `{{PREAMBLE}}`
  declares one; fork-only skills were assigned by analogy).
  VERSION/CHANGELOG stay at the last merged upstream release; the v1.71.0.0
  entry arrives with the full merge. Fork-side adaptations to remember when
  that merge happens: `gbrainConfigDir` keeps the fork's `GBRAIN_HOME`
  convention (upstream #2521 differs), the retro "features shipped" inputs
  live in a separate Step 1.5 fence (the metrics script is local-reads-only),
  `bin/gstack-usage-report` knows the skill-start / skill-end record shapes,
  and the script contract tests spawn through `bash` on Windows.

## Branch map

- `custom/frontmatter-routing` — the live line; contains everything above,
  including `windows-fixes-and-enhancements` (merged 2026-08-15).
- `observe-phase1`, `synth-phase1`, `watch-phase1` — WIP runtime/observability
  work in worktrees under `~/dev/gstack-worktrees/`, idle since May 2026.
- `feat/force-multiplier-a1-a3` — WIP.
- `backup/*`, `backup-pre-*` — pre-merge snapshots, keep.
