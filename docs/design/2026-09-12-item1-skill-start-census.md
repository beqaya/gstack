# Item 1 — absorbing upstream's skill-start runtime: measured before starting

Date: 2026-09-12
Status: measured, not started. The numbers say it is a focused day, not a
merge session, and that it should be done as a cherry-pick of one release
rather than inside the full upstream merge.

## What upstream built (v1.71.0.0, #2691)

The ~18 KB of shared preamble bash that every tier-2+ skill inlined moved into
two runtime scripts: `bin/gstack-skill-start` (554 lines) and
`bin/gstack-skill-end` (60 lines). A generated skill now carries a six-line
invocation fence and the prose that interprets the echoed `KEY: value` STATUS
lines. Eight one-time onboarding generators moved into skill-start's
instruction-emission layer and render only when their runtime gate fires.

Their receipt, from `gstack-context-bill --diff`:

| Ledger | Before | After |
|---|---|---|
| /review eager per invocation | ~26.6K tokens | ~13.0K tokens |
| /land-and-deploy eager | 109.8 KB | 54.4 KB |
| /codex eager | 100.0 KB | 53.9 KB |

**All 14 AskUserQuestion format pins stayed in every tier-2+ skeleton.** That is
the property A5 could not deliver: upstream moved the bash, not the prose, so
`test/auq-format-always-loaded.test.ts` never fires. A5 is dropped; this is
the version of it that works.

## Cherry-pick dry run (`git merge-tree --merge-base=394db326^ HEAD 394db326`)

| Conflicting files | Count | Cost |
|---|---|---|
| Generated SKILL.md | 52 | Free — regenerate |
| Templates .tmpl | 11 | Hand judgement |
| Resolvers | 8 | Hand judgement |
| Tests | 19 | Mostly follow code |
| `bin/` | **0** | Clean |

93 files conflict; 52 are regenerated output. The two runtime scripts come in
clean, which is the part that would have been hard to port. The hand-work set
is 19 files: `preamble.ts` plus seven `preamble/generate-*.ts`, and eleven
templates.

## Why cherry-pick, not the full merge

The full upstream merge conflicts on 464 files and drags in the Aside browser
waves, which do nothing on Windows. Release 394db326 is self-contained — a
token-load programme with its own contract test (`test/gstack-skill-start.test.ts`)
— and lands the largest single win available without deciding anything about
browsers.

## What to watch

- `gstack-skill-end` writes a THIRD record shape to `skill-usage.jsonl`
  (`{skill, duration_s, outcome, browse, session, ts}`). `gstack-usage-report`
  and `gstack-reflect-collect` must learn it or they will mis-count again.
- Upstream's `generatePreamble` now throws when a template lacks
  `preamble-tier`; every fork template must declare one.
- Upstream also ships `timeline-stop-hook`, which closes dangling "started"
  timeline entries on every Stop. Worth taking in the same pass.
- Verify with the eval suite, not by reading: the four plan-review cases
  must still score 4/4 after the preamble change.
