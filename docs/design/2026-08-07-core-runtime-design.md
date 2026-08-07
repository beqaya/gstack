# Sub-project A — Core runtime: design spec

Date: 2026-08-07
Status: design approved section-by-section by the founder; ready for an implementation plan
Scope: gstack tooling only. No consuming project is modified.

## Why this exists

The founder asked for gstack to become an autonomous brain with a development
army, a cybersecurity department, and stronger core AI functionality. An
inventory of the existing 59 skills showed that most of the *named* capabilities
already exist:

| Requested | Already present |
|---|---|
| Development army | 8 planning + 7 quality + 4 CI/CD skills |
| Browser integration | 6 browser skills |
| Memory management | 5 memory/context skills, plus gbrain |
| Orchestration | `delegate`, subagent patterns, workflows |
| Self-enhancement | `gstack-evolve`, `reflect`, `plan-tune`, `capture-lesson` |
| Cybersecurity department | 1 skill (`cso`) |
| Token management | nothing |

So the gap is not "more skills." It is that **the 59 skills are guidance, and
almost nothing is enforced.** The 2026-08-06 audit of the suite found:

- 45 of 59 skills claimed a `PreToolUse` hook that was never installed
- 5 skills had mandatory safety gates that fast paths jumped straight past
  (`ship` ×3, `land-and-deploy`, `sync-gbrain`, `setup-gbrain`)
- the generated-file guard shipped looking correct and was inert
- `ln -s` exits 0 on this machine while silently writing a plain copy
- `pbcopy` no-ops on Windows while the script printed "copied to clipboard"

Every one of those *reported success it had not achieved*. That is the failure
mode an autonomous system amplifies: with nobody watching, a confident wrong
report is indistinguishable from a correct one. **Verification is therefore the
foundation of this runtime, not a later phase.**

## Decisions locked with the founder

| Decision | Choice |
|---|---|
| Autonomy level | Unattended sessions on assigned work |
| Blocked approvals | Park and continue; batch report on return |
| Verification bar | Risk-tiered; elevated claims get a second agent |
| Token budget | Hard ceiling, graceful stop with resume point |
| Journal → memory | Keep everything, searchable (see Documented bet) |
| Architecture | File-backed hybrid; no daemon |

## Architecture

**A run is a directory, not a process.** Durable state lives in plain files under
`~/.gstack/runs/<run-id>/`. Claude Code sessions are disposable workers that read
and write that state through thin `bin/` CLIs. Enforcement lives in `PreToolUse`
hooks, the only mechanism in this harness proven to actually block a tool call.

Rejected alternatives:

- **Session-native** (everything inside one session): dies with the session, so a
  hard token ceiling cannot hand off to a later run. Fails the core requirement.
- **Supervisor daemon** (long-running process owning the queue): genuinely
  unattended, but adds a Windows service to install, keep alive and debug. Most
  of this toolchain's existing friction is already Windows-specific; a daemon
  adds a new class of it.

The hybrid was chosen because it matches how gstack already works — `bin/`
scripts plus hooks plus state under `~/.gstack` — which is the pattern behind
`gstack-failure-count`, the generated-file guard and the sentinel override, all
of which work today.

## State layout

```
~/.gstack/runs/<run-id>/
  manifest.json    run id, goal, budget, status, created-at
  queue.jsonl      work items and their status transitions
  journal.jsonl    claims with verdict + evidence + timestamp
  parked.jsonl     items blocked on founder approval
  ledger.jsonl     token spend per agent and phase
  resume.json      the resume point
```

Every file except `manifest.json` and `resume.json` is **append-only JSONL**.
Appends at these sizes are atomic, so concurrent workers cannot corrupt each
other; a crash mid-write loses at most the trailing line rather than the file;
and history is inherent rather than bolted on, which the keep-everything memory
decision requires anyway.

Only `bin/gstack-run-*` writes these files. Agents never edit them directly.

Workers claim items with an **atomic-create lock** (`O_EXCL` / `CreateNew`) — the
same mechanism already used by `session-lock`, which the enforcement audit
confirmed is a real OS-level guarantee rather than an advisory claim. Two workers
cannot take the same item.

Locks carry a heartbeat and a TTL. A worker that dies holding a lock would
otherwise strand its item forever, and the run would report "queue drained" while
work sat orphaned.

## Lifecycle

`init → claim → work → verify → record → (park | done)`

A run ends when the queue drains, the token ceiling is reached, or the circuit
breaker trips. **All three write the same resume point.** Resumption is the
normal exit path, not a special path only exercised during failures — a recovery
path used only in emergencies is a recovery path that is never tested.

## Components

Five units, each with one responsibility.

### 1. `gstack-run` — sole writer of run state

Subcommands: `init`, `claim`, `done`, `park`, `journal`, `budget`, `resume`,
`status`. Depends on nothing but the filesystem, making it the easiest component
to test and the least likely to break. Schema validation lives here and only
here.

### 2. `run-supervisor` — the worker loop

A skill, not a daemon. Claims an item, does the work, requests verification,
records the verdict, then parks or completes. Holds no state of its own; killing
it mid-item is safe because the next session resumes from the files.

### 3. `risk-classify` — assigns a verification tier

**Deliberately a lookup table, not model judgment.** Actions matching known
patterns — touches prod, writes outside the repo, deletes, pushes, sends mail,
changes settings — return `elevated`. Everything else returns `routine`.

This is the component most likely to be ruined by making it clever. Model
judgment about risk is exactly what failed on 2026-08-06: every incorrect claim
felt correct when it was made.

### 4. `verify-dispatch` — spawns the independent verifier

For `elevated` items, spawns a *different* agent that re-derives the result from
primary sources — re-runs the command, reads the file from disk, queries the live
object — rather than reading the worker's report and agreeing.

The verifier's brief must carry the **domain facts** it needs, not just the task.
Three defects in one day were traced to briefs that omitted them, and the Windows
agent on 2026-08-06 only caught the `ln -s` bug because its brief warned that
MSYS silently redirects bare paths to `.exe` siblings.

### 5. Budget hook — enforces the ceiling

A `PreToolUse` hook. A budget that asks nicely is not a budget. Checked on every
tool call, so a runaway loop is stopped by the next call rather than by a
periodic sweep that may never arrive.

## Data flow

```
claim ──► work ──► classify ──► verify ──► journal ──► park? ──► done
  │                                │                      │
  └─ O_EXCL lock            routine: tests          blocked: parked.jsonl
                            elevated: 2nd agent      (run continues)
```

**The verdict is what gets written, not the claim.** `journal.jsonl` records
`PROVEN`, `UNPROVEN`, or `CONTRADICTED` with the evidence and a timestamp.
Default is `UNPROVEN` until evidence is shown.

Parked items never block independent work. The run continues and presents one
batched approval list when the founder returns.

## Error handling

| Failure | Response |
|---|---|
| Worker dies mid-item | Lock TTL expires, item requeued |
| Verdict `CONTRADICTED` | Requeue once with the contradicting evidence, then park |
| Same action fails 3× | Circuit breaker; park with a summary |
| Ceiling hit mid-item | Finish verifying, write resume point, stop |
| State file unreadable | Halt the run; never guess |

The governing principle: **a run may end early, but it may never report success
it did not achieve.** Stopping is cheap. A false "done" is expensive precisely
because nobody was watching.

This produces a deliberate asymmetry:

- **Guards fail open.** If detection throws, allow the action and log it. A guard
  that blocks work when it malfunctions is disabled within a day, and then guards
  nothing.
- **Irreversible resources fail closed.** If the budget hook cannot read the
  ledger, it denies. Overspending cannot be undone; a paused run can be resumed.

`CONTRADICTED` gets exactly one requeue, and the retry brief carries the
contradicting evidence — otherwise the second attempt repeats the first's
reasoning and reaches the same wrong answer.

The existing circuit breaker (`gstack-failure-count`) applies unchanged: three
consecutive failures of the same action or ten total, with infrastructure errors
(`ENOTFOUND`, connection refused, 5xx) granted two free retries because retrying
a network blip is correct.

## Testing

Every guard ships with a **paired block/allow test exercised through the real
tool path**, never through a synthetic payload.

The paired part is not optional. "Blocks generated files" and "blocks everything"
produce identical results until an ordinary edit is attempted. The inert
generated-file guard survived review precisely because only the block case was
checked.

Demonstrated live on 2026-08-07 against the installed guard:

1. Created a throwaway file carrying the `AUTO-GENERATED` marker.
2. Attempted an Edit through the real tool — **denied**, with the message naming
   the source to edit instead.
3. Confirmed the file's bytes were **unchanged on disk** — proving the write never
   happened, not merely that an error was printed.
4. Attempted an Edit to an ordinary file — **allowed**.
5. Deleted both files.

**Acceptance bar for any new check: would it have caught a bug we already had?**
A check that would not have caught the inert guard, the half-fixed CSP, the
`.exe` resolution bug, or the test that silently collapsed 40 skill descriptions
is decoration.

A related trap to avoid: a check must be able to fail. A sweep for bare command
names returned zero both when the fix was correct *and* when the interpolated
variable was empty. A check that passes either way is not a check.

## Documented bet — keep-everything memory

The founder chose "keep everything, searchable" over auto-promotion of curated
lessons, having seen the objection. Recorded as a documented bet, not
relitigated.

**The known risk:** raw history contains claims that were true mid-run and false
by the end. The 2026-08-06 transcript asserts "the guard is working",
"find-browse is fixed" and "the CSP is fixed" — all false — alongside their later
corrections, with equal apparent authority.

**The mitigation, built into this design:** entries are stored with their
verdict, evidence and timestamp, and a later entry that contradicts an earlier
one links back to it. Retrieval prefers verified-and-recent and returns a
contradicted claim *with* its contradiction attached. This is the difference
between an archive and a knowledge base, and it costs nothing extra at capture
time because `verify-outcome` already produces the verdict.

**Review trigger:** if retrieval starts surfacing superseded claims in practice,
revisit auto-promotion rather than adding more search tuning.

## Out of scope

Deferred to their own spec → plan → build cycles, in this order:

- **B — Development army.** SDLC agent roles from requirements through
  maintenance. Needs A's orchestration and verification.
- **C — Cybersecurity department.** Full role and responsibility coverage,
  expanding beyond the single `cso` skill. Needs A; benefits from B's patterns.
- **D — Self-enhancement loop.** Measured improvement rather than vibes. Needs
  A's telemetry to know what actually improved.

Also out of scope for A: goal selection and self-directed work (the founder chose
assigned work, not fully self-directed); adaptive model downgrading; any GUI.

## Verification of this sub-project

A is done when all of the following hold:

1. A run survives its worker session being killed mid-item and resumes from files
   alone, completing the item.
2. A run that reaches its token ceiling stops, writes a resume point, and its
   report distinguishes completed from incomplete work.
3. An `elevated` item is verified by a different agent than the one that did the
   work, and the journal records the verdict with evidence.
4. An item requiring founder approval is parked, the run continues other work,
   and the parked item appears in the final report.
5. Every guard has a paired block/allow test driven through the real tool path.
6. A deliberately falsified claim is caught — inject a worker that reports
   success without doing the work, and confirm verification returns
   `CONTRADICTED`.

Item 6 is the one that matters most. The rest confirm the machinery runs; only
that one confirms it catches the failure this runtime exists to prevent.
