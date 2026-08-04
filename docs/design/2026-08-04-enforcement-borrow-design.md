# gstack enforcement enhancement — design spec

Date: 2026-08-04
Status: approved in brainstorm (scope: borrow 4 mechanisms, no architecture change)
Sources researched: superpowers 6.2.0 (local), GSD / `open-gsd/gsd-core`, Nous
Research `hermes-agent` (225,144 stars, MIT, verified via GitHub API).

## Problem

gstack covers the whole software lifecycle (53 skills: ship, deploy, canary,
security, docs) and persists project memory across sessions — both things its
rivals lack. Its weakness is enforcement: every gate it has measures a PROXY
for correctness, and the agent that does the work is the same agent that grades
it.

This is not theoretical. A worked case, used throughout as the acceptance
fixture (a production React SPA behind Cloud Run and Fly, 2026-08-03):

The site served a blank page to every browser visitor. Its JS bundle returned
500 because the production CORS guard rejected the app's own origin — Vite emits
`crossorigin` on the module script, so browsers send an `Origin` header even for
same-origin subresource loads, which the guard treated as cross-origin and
threw. Meanwhile `/api/health` returned 200, `curl` fetched the bundle fine (it
sends no `Origin`), CI was green, and BOTH deploy workflows reported success.
Every available signal was structurally blind, because not one of them was the
user-visible outcome. The bug surfaced only when a real browser was pointed at
the site, by chance.

The generalisable lesson — the one this design encodes — is that a proxy signal
cannot detect a failure that lives outside what it measures, and a build agent
cannot be relied on to notice what its own work missed.

Separately the same day, three defects were caught ONLY because a different
agent re-verified an implementer's self-report: scheduled tasks that would have
silently skipped on battery power, a memory verdict judged against a cached
config file, and an index entry claiming shipped security fixes were unfinished.
None was caught by self-review.

## Decisions (from brainstorm)

Borrow four mechanisms, one per identified gap. Explicitly NOT borrowed:
superpowers' TDD Iron Law (much of this user's work is infra/docs where
red-green does not apply), GSD's wave scheduler (insufficient parallel volume to
justify), Hermes' pluggable execution backends (irrelevant inside Claude Code).

## Design

### 1. Outcome-evidence gate (borrowed from GSD's verifier role)

New skill `verify-outcome`. Contract:

- INPUT: a claim of the form "X now works".
- The skill requires the invoker to name the USER-VISIBLE outcome, then produce
  evidence a user would recognise. Accepted evidence classes:
  - web UI → rendered DOM containing expected content (not just HTTP status),
    obtained through a real browser
  - API → a real request whose BODY is asserted, not its status code
  - CLI → command output asserted
  - data/job → the row/artifact the job was supposed to produce
- Explicitly REJECTED as sufficient on their own: HTTP 2xx, "tests pass",
  "CI green", "deploy succeeded", "no errors in logs", the implementer saying so.
- OUTPUT: verdict PROVEN / UNPROVEN / CONTRADICTED, with the evidence inline.
- On UNPROVEN it must say what evidence was missing, never pass by default.

Integration: `ship` and `land-and-deploy` gain a mandatory step that invokes
this gate before reporting success. A failure or UNPROVEN verdict blocks the
success report (it does not roll anything back — reporting honestly is the job).

### 2. Independent verifier (borrowed from superpowers' SDD loop)

Not the full five-round capped loop — only the separation of roles, as a rule
plus a reusable dispatch pattern:

- Any gstack skill that FIXES or BUILDS something dispatches a DIFFERENT agent
  to verify the result.
- The verifier is briefed to re-derive from primary sources (re-run the command,
  re-read the file from disk, re-query the live object) — never to read the
  implementer's report and concur.
- The verifier brief must carry DOMAIN FACTS, not just the task: what the
  relevant exit codes mean, which file is authoritative, what "done" looks like.
  (Both subagent failures on 2026-08-03 were correctly-instructed but
  under-informed agents.)
- Cheap model for implementation, capable model for the verifying pass.

Delivered as: a new `references/independent-verification.md` in the gstack repo
that the relevant skills point to, plus the rule stated in the user's global
CLAUDE.md so it binds even outside gstack.

### 3. Just-in-time learning capture (borrowed from Hermes `skill_manage`)

New skill `capture-lesson`, invoked at the MOMENT of learning rather than in the
weekly `/gstack-evolve` batch. Triggers:

- a defect found after something was already called done
- an error recovered from after non-trivial diagnosis
- an explicit user correction

Behaviour: write the lesson immediately as a memory file (durable fact) or a
skill draft (procedure), following Hermes' own split between facts and
procedures. Drafts still require review before activation — the existing
`gstack-evolve` review convention is reused, not replaced. `gstack-evolve`
remains the weekly sweep for patterns too diffuse to notice in the moment.

### 4. Locked state spine (borrowed from GSD's `STATE.md`)

`docs/STATUS.md` already exists by convention. Make it enforced:

- read-first / write-last, as today, but with an advisory lock file
  (`docs/.STATUS.lock` containing session id + timestamp) taken before a write
  and released after.
- A stale lock (older than 30 minutes) may be broken, with the breaking session
  recording that it did so.
- Sessions announce ownership of a sub-project in their STATUS.md row.

Rationale: on 2026-08-03 two sessions pushed to `main` within minutes of each
other. The convention existed; nothing enforced it.

## Error handling

- Every new skill fails LOUD and never silently passes: `verify-outcome`
  returning UNPROVEN is a blocking result, not a warning.
- The lock is advisory only — it must never prevent an emergency fix. Breaking a
  stale lock is legal and logged.
- `capture-lesson` writing a draft must never auto-activate a skill.

## Testing / verification

- `verify-outcome` is validated against the 2026-08-03 outage as a fixture: run
  it against the pre-fix state (must return CONTRADICTED — proxies green, DOM
  empty) and the post-fix state (must return PROVEN).
- The independent-verification rule is validated by a fresh-context agent asked
  "how do you verify a fix?" — it must describe re-deriving from primary
  sources, not reading a report.
- The lock is validated by simulating two concurrent writers.
- `capture-lesson` is validated by feeding it the CORS incident and confirming
  it produces a correctly-typed memory (fact) rather than a skill draft.

## Out of scope

TDD Iron Law; GSD wave scheduling; Hermes execution backends; any change to the
53 skills' existing behaviour beyond the two ship-path integrations; rebuilding
superpowers' capped fix loop inside gstack.

**Explicitly out of scope: any consuming project's repository.** This is a
general gstack enhancement. Everything ships inside the gstack repo as skills
and conventions that any project may adopt; nothing here edits a project's files,
assumes its layout, or depends on its tooling. The state-spine mechanism is
therefore a skill that takes the tracker path as an argument, not an edit to one
project's status document.
