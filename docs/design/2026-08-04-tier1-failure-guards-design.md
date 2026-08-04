# Tier 1 — failure guards: design spec

Date: 2026-08-04
Status: tier selected by founder; design presented in this document for review
Scope: gstack tooling only. No consuming project is modified.

## Problem

Four failure modes hit this toolchain in a single working session. None was
caught by tests, CI, review checklists, or self-review, because each one
produces work that *looks* finished:

1. **Edits to build output.** `SKILL.md` files are generated from `SKILL.md.tmpl`.
   A hand-edit to the generated file survives until the next generator run and
   is then silently reverted. This happened: a 53-skill frontmatter refactor was
   made in generated files, and one regeneration reverted 40 of them with no
   error. Separately, a binary-path fix was nearly applied to 160 generated
   files instead of the 3 sources they derive from.
2. **Inert edits.** The live skills under `~/.claude/skills/<name>/` are COPIES
   of the repo, not junctions. A correct repo edit changes nothing the user runs
   until it is copied. Every task in the preceding plan needed a manual parity
   check, and one implementer died mid-sync leaving repo and live divergent.
3. **Thrashing on failure.** An agent misread a Windows scheduler code
   (267009 = SCHED_S_TASK_RUNNING, i.e. still running), concluded failure, and
   killed its own healthy task — then reported the kill as evidence of a bug.
   Nothing bounded the retry loop or forced a summary instead of another attempt.
4. **Verifying the wrong thing.** A CSP fix passed typecheck, four green
   workflows, a visibly changed response header, and a rendering page — and was
   still incomplete, because the check that mattered (browser console) was the
   one not run. The author picked the checks, so the checks matched the author's
   model of the bug.

The common shape: **the signal that would have caught it was not among the
signals anyone thought to look at.**

## Design principle carried from the same session

`allowed-tools` in skill frontmatter is ADVISORY. It is checked against tool-name
strings; nothing inspects what a permitted tool is used for, and `Bash` can write
files regardless. The mechanism that actually blocks a tool call in this harness
is a **`PreToolUse` hook returning `permissionDecision: "deny"`** (see
`freeze/SKILL.md`, which implements exactly this). Therefore: anything in this
spec that must be *enforced* is a hook. Anything that is guidance is a skill or a
rule, and is described honestly as guidance.

## Components

### 1. Generated-file guard — `PreToolUse` hook (ENFORCED)

**Trigger:** `Edit` or `Write` where the target path resolves to generated output.

**Detection**, in order, first match wins:
- the file's first 5 lines contain `AUTO-GENERATED` (gstack's own marker), or
- a sibling `<file>.tmpl` exists, or
- the path lies under a known generated tree: any `.agents/`, `.cursor/`,
  `.factory/`, `.gbrain/`, `.hermes/`, `.kiro/`, `.openclaw/`, `.opencode/`,
  `.slate/` skills directory.

**Action:** deny, with a message that names the SOURCE to edit instead
(`<file>.tmpl` when it exists; otherwise the resolver/template under `scripts/`
that emits the pattern) and states the regeneration command including the
required flag: `bun run gen:skill-docs -- --catalog-mode=full`.

**Escape hatch:** an explicit override token in the edit rationale
(`GENERATED-EDIT-INTENTIONAL`) allows the write, because regenerating is
sometimes genuinely wrong (an emergency hotfix to a shipped artifact). The hook
logs every override to `~/.gstack/analytics/generated-overrides.jsonl` so the
escape hatch cannot become the silent default.

**Non-goal:** the hook does not run the generator. Regeneration rewrites ~53
skills plus nine adapter trees and is a deliberate act.

### 2. Live-vs-source parity — `/parity` skill (GUIDANCE) + hook reminder

**Skill `parity`:** compares every `~/.claude/skills/gstack/<name>/SKILL.md`
against its live counterpart `~/.claude/skills/<name>/SKILL.md` and reports:
IDENTICAL count, DRIFTED list (with which side is newer), REPO-ONLY (exists in
repo, never synced — the skill is invisible to the user), LIVE-ONLY (exists live
but not in repo — an orphan or hand-created skill).

`--sync` copies repo → live for drifted entries and re-verifies by hash. It never
copies live → repo, because the repo is the source of truth and the reverse
direction would launder a hand-edit into version control.

**Hook reminder:** the generated-file hook's deny message includes a one-line
pointer to `/parity` for the same reason the drift exists — people forget the
copy step. This is a reminder, not enforcement; a repo edit that is never synced
is not itself an error, only an incomplete action.

### 3. Failure circuit breaker — convention + counter (GUIDANCE)

**Rule:** stop after **3 consecutive failures of the same action**, or **10
total failures within one task**, and produce a SUMMARY instead of another
attempt. The summary states: what was attempted, what each attempt returned,
what the attempts have in common, and the two most likely explanations. Then it
stops and waits.

**Counter:** `bin/gstack-failure-count <task-id> [--record <outcome>|--reset]`,
storing counts in `~/.gstack/failures/<task-id>.json`. Kept as a helper rather
than a hook because "failure" is not a tool-level event — an exit code of 1 can
be a correct answer, and a 200 can be a failure.

**Anti-rationalizations**, stated explicitly because they will occur:
- *"This attempt is different."* If the difference is only a parameter tweak, it
  is the same action. Different means a different hypothesis about the cause.
- *"One more will do it."* That is what the previous two said. Summarize; the
  human can tell you to continue in one word.
- *"The failure is transient."* Then say so in the summary and stop anyway —
  transience is a hypothesis, and three occurrences is evidence against it.

**Explicit carve-out:** genuine infrastructure errors (`ENOTFOUND`,
`ConnectionRefused`, API 5xx) do NOT count toward the breaker on their first two
occurrences, because retrying a network blip is correct. They start counting on
the third, since a persistent network failure is not transient.

### 4. Falsification-first — extend `verify-outcome` (GUIDANCE)

Add one step before Step C's verdict:

> **Step B2 — name the falsifier.** Before recording a verdict, state the single
> observation that would prove this claim WRONG, then go make that observation.
> If you cannot name one, you have not understood the claim well enough to
> verify it. The falsifier must be something you have not already checked —
> naming a check you have already run is not falsification, it is confirmation.

**Worked example to embed** (from this session): the claim was "the CSP is fixed
so PostHog works." The checks run were typecheck, CI, deploy status, the response
header, and the page rendering — all passed. The falsifier not run was: *open the
browser console and look for refusals*. Running it showed five scripts still
blocked by a second directive. The fix was half done and every other signal said
otherwise.

**Why this is guidance, not enforcement:** no hook can tell whether a named
falsifier is honest. The value is the forced question, and a dishonest answer to
it is visible to a reviewer in a way that a skipped check is not.

## How the four interact

1 and 2 are the same failure at different layers — editing the wrong file, and
editing the right file in the wrong place — so the hook's message points at
`/parity`. 3 and 4 both fire at the end of work: 3 when it will not converge, 4
when it appears to have converged. Together they cover both exits from a task.

## Error handling

- The hook must FAIL OPEN: if detection throws, or a path cannot be read, allow
  the edit and log the failure. A guard that blocks work when it malfunctions
  will be disabled within a day, and then guards nothing.
- `/parity --sync` refuses to run when the repo working tree is dirty in the
  files it would copy, so uncommitted experiments are not pushed live.
- The failure counter is advisory state; a missing or corrupt count file resets
  to zero rather than blocking.

## Verification

Each component is validated against the incident that motivated it, not against
a synthetic case:

1. **Generated-file guard:** attempt an edit to `qa/SKILL.md` — must be denied
   and must name `qa/SKILL.md.tmpl`. Attempt an edit to
   `scripts/resolvers/browse.ts` — must be allowed. Attempt an edit to
   `.cursor/skills/gstack-qa/SKILL.md` — must be denied. Confirm an override
   token permits the write and writes one line to the override log.
2. **Parity:** desync one skill deliberately, confirm it is reported DRIFTED and
   that `--sync` restores hash equality; confirm a repo-only skill is reported
   as invisible-to-user.
3. **Circuit breaker:** simulate three identical failures and confirm the third
   produces a summary rather than a fourth attempt; simulate two `ENOTFOUND`
   errors and confirm they do not trip it.
4. **Falsification:** re-run `verify-outcome` against the mid-fix CSP state
   (connect-src fixed, script-src not). With Step B2 present it must reach
   CONTRADICTED via the console; without it, the older rules reached PROVEN.
   That delta is the acceptance test.

## Out of scope

Classifier-based approvals (needs a second model in the loop); TDD-as-law; any
GUI; the Tier 2 and Tier 3 ideas; running the doc generator automatically.
