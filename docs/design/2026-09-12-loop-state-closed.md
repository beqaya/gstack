# Closing the run loop's open state — and what it turned up

Date: 2026-09-12
Status: both abandoned runs are closed. The August UNPROVEN entry is resolved.
Three new findings, one of which changes how today's routing fix should be read.

## The two runs, closed with the machinery rather than by editing files

**17ca8cafe958** — "Sub-project D: measure what the runs already record". One
item, `build gstack-metrics over existing run files`, claimed and journaled
PROVEN but never marked `done`, so the run stayed `active`. `bin/gstack-metrics`
exists and runs, so the work was complete and only the bookkeeping was missing.
Marked done, stopped `queue-drained`.

**f0b236074d70** — "B: first real improvement cycle". Three items, all generated
as findings by `gstack-metrics`:

| Item | Title | Disposition |
|---|---|---|
| 884d418f5f | 61 skills cannot be reached by any phrase | already `done` in August |
| 9def988789 | 6 distinct skills have recorded a use | journaled PROVEN, done |
| 3b21223705 | claims were overturned in 2 stage(s) | skipped, not a task |

The worker was `session-a226f5ae` — the session whose transcript saving broke,
per `reference_session_a226f5ae_handoff`. The run was abandoned because that
session died, which is exactly the unwired-budget-guard consequence the
core-runtime followups predicted.

`3b21223705` was skipped rather than closed: a superseded or contradicted claim
is the record of verification working, not a defect. `gstack-metrics` still
reports one in `build` and one in `review`, and the right response is to keep
verifying those stages.

Note what item `884d418f5f` was: **the same routing defect measured and fixed
today.** In August the loop found it and fixed it for 42 cyberteam skills by
declaring trigger phrases. The gstack `plan-*` skills were left, and today's
eval caught them independently. The loop was right a month ago and stopped one
step short.

## The UNPROVEN entry is resolved — both defects are fixed

`caf5a03d4c1a` entry `142b7967dc` recorded UNPROVEN with two specific findings
from an independent reviewer. Both were re-derived today rather than taken on
trust:

1. **`reject_thin` absent from `park --action/--reason`.** Fixed. A park with
   one-character values now exits 22 with "`--action` is a placeholder", and a
   substantive park exits 0. The floors are at `bin/gstack-run:778-779` and
   `:852-853`.
2. **Mutation proved lowering every length floor to 1 left the suite green.**
   Fixed. Re-running that exact mutation — all seven floors set to 1 — now turns
   **5 tests red** across `run-park`, `run-journal`, `run-cli` and
   `gstack-run-acceptance`. The mutant was reverted immediately after.

## Three new findings

### 1. The tier is asked for but never required

`run-supervisor` Step 5 says to pass the tier from Step 3 through. `gstack-run
journal` declares `--tier` with `default=None`, so omitting it is silent. All
four entries in `9a5f7d592b1d` carry `tier: None`. Same prose-trigger class as
the skill-usage recorder and the ACE Reflector: an instruction nobody enforces.

### 2. Running the test suite rewrites 57 generated files

`test/catalog-mode-full.test.ts` regenerates every `SKILL.md` in
`--catalog-mode=full` **in the working tree**, not a temp dir. After a suite run,
57 files show as modified with untrimmed descriptions. Anyone committing after a
test run ships a catalog-mode change they did not intend.

### 3. The discovery-surface budget is blind in this fork's canonical mode

`test/catalog-mode-full.test.ts:62` states plainly: *"This fork's canonical
resting state is `--catalog-mode=full`"*. But `main` and every live copy under
`~/.claude/skills/` are committed in TRIM mode — which is how two `plan-*` skills
came to be unroutable.

Worse, the ceiling that was cited as the reason not to widen descriptions does
not measure them in full mode. `parseFrontmatter` in
`test/catalog-budget.test.ts:58-66` handles the folded block scalar
`description: >-` but not the literal `description: |` that full mode emits, so
the fallback regex captures the single character `|`.

| | Bytes | Token-equivalents |
|---|---|---|
| What the budget test measures | 56 | 14 |
| What is actually always-loaded | 29,433 | 7,359 |
| Its own ceiling | — | 1,270 |

All 56 skills use a literal block in full mode, so the test is blind to 100% of
the surface it exists to cap, and passes at 5.8x over its ceiling.

**This reframes today's routing fix.** Rewriting two lead sentences was correct
and helps in either mode, but the root cause was not weak lead sentences — it was
generated files sitting in trim mode while the fork's declared resting state is
full. Which mode should be committed is a founder decision: trim costs ~1,057
always-loaded tokens and loses every trigger phrase; full costs ~7,359 and keeps
them.
