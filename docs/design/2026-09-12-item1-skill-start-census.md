# Item 1 — absorbing upstream's skill-start runtime: measured before starting

Date: 2026-09-12
Status: landed on `feat/skill-start-absorb` (2026-09-12) as a cherry-pick of
394db326 with the fork's onboarding sentinel, Lake wording and Windows test
spawning ported. Measured result and what was left out are at the bottom.

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

## Outcome (2026-09-12)

`gstack-context-bill --diff` of main vs the branch, eager per-invocation
ledger (the always-on catalog moved by under 200 tokens):

| Skill | Before | After |
|---|---|---|
| /review | 108.6 KB | 55.0 KB |
| /land-and-deploy | 107.0 KB | 55.8 KB |
| /codex | 98.3 KB | 53.3 KB |
| /autoplan | 102.6 KB | 58.0 KB |
| every other tier-2+ skill | | about -20 KB each |

The conflict census held: 0 `bin/` conflicts, 52 regenerated SKILL.md files,
7 templates and 8 resolvers by hand. Runtime cost is unchanged: on this
Windows box the new script takes about 18 s in a cold home and the old inline
fences took about 16 s, both dominated by Git Bash process spawn.

What was NOT absorbed (needs the intermediate releases v1.65-v1.70):
`touchfiles-data.ts` split, the ship `apple-release` section, #2700
document-release anchors, `UNDER_CODEX`, `gstack-issue-guard`, the
`skill-e2e-retro` test, the cso catalog trim, and #2521 `GBRAIN_HOME` semantics.
The four onboarding gates in `bin/gstack-skill-start` carry the fork's
`~/.gstack/.onboarding-deferred` sentinel; port it again if upstream rewrites
that block.

Correction to the "What to watch" list: the skill-end record shape is not new.
The old inline "Telemetry (run last)" fence already wrote the same line, so
`gstack-reflect-collect` (matches on `session`) was fine; `gstack-usage-report`
now labels start lines as `skill-start` and no longer counts the end line as a
second observation.

## Behavioral verification (2026-09-13, item 3)

Run on the logged-in CLI (`EVALS_HERMETIC=0`, detached via `bin/gstack-detach`
with the real `bun.exe`; the npm shim is not resolvable from the detached
relaunch on Windows):

| Test | Result |
|---|---|
| skill-e2e-preamble-script-ab (script arm) | 7/7 STATUS keys read |
| skill-e2e-preamble-script-ab (inline arm) | 7/7 STATUS keys read |
| plan-ceo / plan-devex plan-mode (gate) | 3 pass |
| plan-eng plan-mode (periodic) | pass |
| plan-design plan-mode (periodic) | 1 fail of 3 attempts, then 2 pass on rerun |

The plan-design failure was two 300 s timeouts and one run that finished
without the auto-select announcement; its scope-gate prose is byte-identical
before and after the absorb, and the isolated rerun passed both cases. Logs
under `~/.gstack-dev/eval-runs/preamble-*` and `plan-design-rerun-*`.

