# Core runtime — known gaps and follow-ups

Date: 2026-08-08
Status: recorded at the close of the sub-project A build (spec `2026-08-07-core-runtime-design.md`,
plan `2026-08-07-core-runtime-plan.md`). All 9 tasks complete, 55 tests passing, final
whole-branch review merge-clean.

This file exists because the build's working ledger is scratch and gets deleted. These
items are real, were adjudicated deliberately, and would otherwise be lost.

## Requires a founder decision

### The budget guard is not wired — there is no token ceiling today

`bin/gstack-budget-guard` is built, tested (7 tests) and correct. It is **not** registered in
`~/.claude/settings.json`, and no task in the plan ever registered it. Verified directly: the
only `PreToolUse` entries are `preedit-stash.ps1` + `gstack-generated-guard` (matcher
`Write|Edit`) and `question-preference-hook.ts` (matcher `AskUserQuestion`).

Consequence for an unattended run **today**: there is no token ceiling at all. Not a loose
one — none. `run-supervisor` tells the worker "every tool call passes the budget guard", which
is currently false, so a faithful worker never stops for budget, never calls
`stop --why budget-exhausted`, and when the session dies there is no `stop` at all: no
`resume.json`, and the manifest stays `"active"`.

**Acceptance criterion 2 of the design spec is unsatisfiable until this is wired.**

Wiring modifies `settings.json`, which the founder's CLAUDE.md places behind an explicit ask.
The registration command follows the pattern already used for the AskUserQuestion hook:
`bin/gstack-settings-hook add-event --event PreToolUse --command "<python> <guard>" --source core-runtime --matcher "*"`.

Note the matcher choice matters: the guard is inert unless `GSTACK_ACTIVE_RUN` is set, so a
broad matcher is safe, but it must be deliberate.

## Highest-probability real-world defect

### No heartbeat refresh — a live lock is reaped when the TTL expires

**PARTIALLY MITIGATED 2026-08-08: `GSTACK_LOCK_TTL_SEC` default raised 900 → 7200 (two hours),
founder's call.** That makes the failure rare rather than routine — an ordinary long item no
longer outlives its own claim — but it does not fix the underlying gap, and an item exceeding
two hours still hits it.

Nothing ever refreshes a lock's heartbeat. Any item that legitimately takes longer than the TTL
has its **live** lock reaped by the next `claim`, and a second worker takes the same item. No
race is required; this is the normal path.

Compounding it: `cmd_done` and `cmd_park` take no `--worker` and unlink the lock
unconditionally, so either of two live workers can delete the other's lock and free the item
for a third.

Unattended work is precisely the workload where multi-minute items are ordinary. Fix options,
in increasing order of effort: raise the TTL substantially; add an ownership check so only the
holder may `done`/`park`; add a real heartbeat-refresh subcommand the supervisor calls between
steps.

## Deferred — real, non-blocking

| Item | Detail |
|---|---|
| `run-supervisor` doc is stale | The skill says `done` refuses only a CONTRADICTED item. It now also refuses an item with no journal entry (exit 14) and one whose latest verdict is UNPROVEN (exit 13). Fails closed, so this is friction, not danger. |
| `atomic_write_json` uses a fixed `.tmp` name | Two concurrent `stop` calls on one run share the temp filename and could interleave. |
| Exit 2 collides with argparse | A caller branching on exit 2 cannot distinguish "no such run" from a usage error. Cheapest fix is moving no-such-run off 2. |
| Wrong-shaped JSON raises KeyError | `open_items` and `cmd_report` index `rec["item_id"]`/`rec["event"]` unguarded, so a line that is valid JSON of the wrong shape produces a raw traceback (exit 1) rather than a deliberate code. |
| `--why breaker-tripped` is unreachable | `stop` accepts it but nothing produces it: the supervisor skill has no circuit-breaker path, despite the plan claiming it "references `gstack-failure-count` rather than rebuilding it". |
| `stop --why queue-drained` accepted with open items | The contradiction is at least visible in the same JSON object. |
| park's two appends are not atomic | A crash between them, followed by TTL reclaim and a normal `done`, leaves a stale parked record so `report` labels finished work as awaiting approval. Fails in the SAFE direction (over-reports parked). Both records carry `ts`, so timestamp reconciliation is cheap when next touching that code. |

## The real fix for tier classification — derive it from paths, not prose

Two independent verifiers found the same shape of hole in `gstack-risk-classify`,
and patching the pattern list only narrows it:

- The tier is **self-reported**. A worker can pass `--tier routine` on genuinely
  elevated work and the runtime cannot know better.
- The table matches literal substrings against **free text the worker writes**.
  `edit bin/gstack-run` was elevated while `update`/`patch`/`rewrite bin/gstack-run`
  were routine — word choice alone defeated the gate on the file that enforces
  every other gate. Verb variants were added, but `bin/gstack-run: add resolve`
  (no verb at all) still slips through, and always will.

**The structural fix already has its input available.** `done --touched <path>`
collects the exact files an item changed. Tier could be derived from those PATHS
rather than from a prose description: if an item touched `bin/`, a guard, a
workflow, `.env`, or a `.pem`, it is elevated — regardless of how the worker
described it, and regardless of what tier it claimed.

That closes both holes at once: paths are observed, not asserted, so a worker
cannot phrase its way out or mislabel. The prose classifier would remain useful
as an *early* signal during the work, but `done` would be the enforcement point,
comparing declared tier against touched paths and refusing a mismatch.

**BUILT 2026-08-08 (`f6118bdb`).** `done` now derives the tier from `--touched`
paths: anything under `bin/`, `hooks/`, `.github/workflows/`, `migrations/`, or a
`settings.json` / `.env` / `.pem` / `.ssh` file makes the item elevated, and
closing it then requires an elevated journal entry naming a verifier (exit 19).
The prose classifier remains an early signal during the work; `done` is the
enforcement point. 72 tests.

Residual, and it is inherent: this only binds when the worker passes `--touched`.
A worker that omits the flag skips the check. Making `--touched` mandatory is the
obvious next tightening, but it would break every existing caller and needs a
deprecation pass rather than a flip.

## Adjudicated as not worth doing

- **`resume.json` written before the manifest rewrite.** Both writes are idempotent, re-running
  `stop` repairs it, and the observable state (resume point present, manifest still `active`) is
  the *safe* reading for a resumer. The reverse order is genuinely worse.
- Task 1's docstring forward-reference to `resume.json` — resolved by Task 8.
- Test harness defaulting to `python` rather than `python3` — correct for this machine.
- `open_items()` naming; two-superseders last-wins link; test tmp dirs not cleaned;
  risk-classifier trailing newline. All examined and judged fine.

## What the runtime structurally guarantees, and what it does not

This distinction is the whole point of the project and should not be lost.

**Structurally enforced** — a worker cannot violate these regardless of what any skill says:
two workers cannot hold one item lock; `done` refuses an item with no journal entry, a
non-PROVEN latest verdict, or an unreadable journal; `claim`/`park` refuse an unreadable queue;
`park` refuses a second park; `--supersedes` must belong to the same item; `budget-record`
refuses negative tokens; a schema mismatch halts; `report`/`parked`/`history` fail closed on
unreadable input; parked items are excluded from `completed`.

**Rests on the worker choosing to comply**: that the recorded verdict reflects what was actually
observed; that an elevated item was verified by a *different* agent; that `risk-classify` is run
at all; that CONTRADICTED gets exactly one requeue; that the circuit breaker is applied; that
the worker calls `stop`.

Two of these deserve emphasis. **Nothing records who verified** — `cmd_journal` has no verifier
field, so acceptance criterion 3 ("an elevated item is verified by a *different* agent") is not
merely unenforced, it is **unauditable**: the fact is unrepresentable in the state files and can
never be checked after the fact. Adding a `--verifier` field is the obvious next increment.

And the honest summary: the runtime structurally prevents one lie — closing out work that was
not verified PROVEN. Everything else is compliance.
