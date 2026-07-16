# Proposal: close the periodic-e2e coverage gap

**Date:** 2026-07-15
**Status:** PROPOSAL ONLY — no workflow file is changed by this spec. The eval-cost decision belongs to the upstream maintainer.
**Component:** Component 3 of the "Make Windows breakage visible" spec (2026-07-15-windows-ci-visibility-design.md).

## The gap (measured 2026-07-15)

- **71** e2e test files exist: `test/skill-e2e-*.test.ts` + `test/*-e2e.test.ts`.
- **14** run in the gate (`.github/workflows/evals.yml`): codex-e2e, gemini-e2e, skill-e2e-bws, deploy, design, office-hours-auto-mode, plan-mode-no-op, plan, qa-bugs, qa-workflow, review, workflow, skill-llm-eval, skill-routing-e2e.
- **9** run periodically (`.github/workflows/evals-periodic.yml`): codex-e2e, gemini-e2e, design, plan, qa-bugs, qa-workflow, review, workflow, skill-routing-e2e (a subset of the gate).
- **~56 run in NEITHER workflow** — they execute only when local diff-selection happens to touch them.

### Uncovered high-value e2e (sample of the ~56)

The entire plan-review matrix beyond `-finding` basics, office-hours variants, setup-gbrain paths, iOS, and session/memory e2e are uncovered, e.g.:
`skill-e2e-plan-ceo-*` (6 files), `skill-e2e-plan-eng-*` (4), `skill-e2e-plan-devex-*` (3), `skill-e2e-plan-design-*` (4), `skill-e2e-office-hours*` (4), `skill-e2e-setup-gbrain-*` (3), `skill-e2e-auq-*` (3), `skill-e2e-autoplan-*` (2), `skill-e2e-ios*` (3), `skill-e2e-memory-pipeline`, `skill-e2e-session-intelligence`, `skill-e2e-cso`, `skill-e2e-diagram`, `skill-e2e-skillify`, `skill-e2e-spec-execute`, `skill-e2e-review-army`, `skill-e2e-learnings`, `skill-e2e-context-skills`, `skill-e2e-first-task-scaffold`, `skill-e2e-overlay-harness`, `skill-e2e-ship-*` (2), `skill-e2e-sidebar`, `skill-e2e-benchmark-providers`, `skill-e2e-brain-privacy-gate`, `skill-e2e-hermetic-canary`, `skill-e2e-opus-47`, `skill-e2e-plan-tune*` (2), `skill-e2e-plan-format`, `skill-e2e-plan-prosons`, `skill-e2e-conductor-prose`, `skill-e2e-context-skills`.

**Why this matters:** `CHANGELOG.md` v1.60.1.0 documents an eval (autoplan dual-voice) that was broken for months and found only by accident, with a note that the missing periodic coverage "is how this eval rotted unnoticed."

## Proposed change (do NOT apply here — maintainer's call)

Replace the hardcoded `matrix.suite` list in `evals-periodic.yml` with a **glob minus a curated exclude-list**, so new e2e files are covered by default and rot is caught. Concrete diff (illustrative):

```yaml
# .github/workflows/evals-periodic.yml — matrix generation step (illustrative)
- id: matrix
  run: |
    # All e2e suites, minus a curated exclude-list of genuinely expensive /
    # environment-bound / non-deterministic ones.
    EXCLUDE='skill-e2e-ios|skill-e2e-ios-device|skill-e2e-ios-swift-build|skill-e2e-sidebar|skill-e2e-overlay-harness|skill-e2e-benchmark-providers'
    FILES=$(ls test/skill-e2e-*.test.ts test/*-e2e.test.ts \
      | grep -vE "($EXCLUDE)\.test\.ts$")
    echo "matrix=$(printf '%s\n' $FILES | jq -R . | jq -sc '{file: .}')" >> "$GITHUB_OUTPUT"
```

- **Exclude-list rationale (each excluded suite named with a reason):** iOS suites need real Apple hardware/simulators; `sidebar`/`overlay-harness` need a live browser+extension; `benchmark-providers` calls multiple paid LLMs. These stay opt-in.
- Everything else (the ~50 plan/office-hours/setup-gbrain/memory/auq/autoplan e2e) enters the periodic matrix automatically.
- Add a small unit test asserting the exclude-list only names files that exist (so a rename doesn't silently drop coverage).

## Cost

- Each e2e eval run is roughly **~$1/file** (LLM-driven). Adding ~50 files → **~$50 per full periodic run**.
- Mitigations for the maintainer to weigh: (a) run the periodic matrix weekly rather than daily; (b) split into a "cheap tier" (deterministic/structural e2e) run often and an "expensive tier" run monthly; (c) shard across the free budget window.
- The current state's hidden cost is silent multi-month rot (the documented autoplan case) — a real correctness/coverage risk that the ~$50/run buys down.

## Why this is a proposal, not a merge

1. The eval-cost/runtime budget is the upstream maintainer's decision, not something verifiable on a local Windows box.
2. A workflow change here would conflict with upstream's own CI budget on the next `git merge origin/main` into `windows-fixes-and-enhancements`.

Recommendation: forward this to the maintainer (it maps directly to `TODOS.md`'s own "periodic-CI coverage decision" item, option (a)).
