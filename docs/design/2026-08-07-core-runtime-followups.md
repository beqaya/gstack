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

## Closed since — fixed, with the evidence

| Item | How it was closed |
|---|---|
| Exit 2 collided with argparse | `read_manifest` now exits **21** for no-such-run, so a caller can distinguish it from a usage error. Found by running the `bug` pipeline on it (run `caf5a03d4c1a`), fixed in `2f40230d`. |
| `run-supervisor` doc is stale | It was already current on the `done` refusals — the row was wrong when written. It is now also current on `release` and the placeholder gate. |
| A journal entry could be filled with stand-ins | `--claim`/`--evidence`/`--verifier` are length-checked and denylisted; a filler value exits **22** (`340b73b6`). This skill filed `--claim "x" --verifier "pending"` one command after building the verifier requirement, and the runtime took it. Verified adversarially: `--verifier pending` clears the 3-char floor and is caught by the denylist alone, case- and whitespace-insensitively. |
| `park` accepted stand-in values into the founder's approval list | `reject_thin` was applied to journal fields but not to `park --action/--reason`, the surface where it matters more — the journal is read after the fact, the approval list is read before a decision. Found by an independent review of the fix above, closed in `8c8f69c4`. |
| The length floors were held in place by nothing | Mutation testing showed all five could be lowered to 1 with the suite green, because every existing case used a denylisted word. Four boundary tests now use strings absent from `PLACEHOLDERS`; each floor lowered alone produces exactly one failure naming that boundary (`8c8f69c4`). |
| The denylist could be stepped around with one character | Closed at the founder's direction after I had argued to leave it open. Placeholders are now compared through `canonical()` — NFKC, casefold, a confusables table, and a strip of everything that is not a letter or digit — so `n/a.`, `N.A.`, `P E N D I N G`, `x . . . . .` and a Cyrillic-`е` `pеnding` all reduce to a known placeholder. Whole-value comparison, so `nomad-7` and `donovan` still pass. Six table-driven tests; disabling the strip fails five of them. |
| The gate caught typed stand-ins but not vacuous prose | Closed at the founder's direction, then **rebuilt after review returned CONTRADICTED on the first attempt**. That version paired a `VACUOUS` substring search with an `OBSERVED` requirement that PROVEN evidence cite a verb, digit, path or quote. Measured against 46 evidence strings a reviewer would genuinely write, it refused **65%** — including every non-English and every non-native-English sample, and including sentences that opened with `OBSERVED`'s own verbs and were then voided by a trailing clause (`reran the failing test and nothing broke elsewhere`). It was also defeated by appending one digit, so its whole cost fell on honest workers. `OBSERVED` is deleted. `VACUOUS` now refuses a value only when removing the phrase leaves fewer than two content words — i.e. when the conclusion *was* the message. Re-measured on 26 realistic strings: 1 refusal, and that one is the pre-existing 25-character floor rejecting `suite green`, not the vacuity rule. Non-matching languages are never refused, which is the correct direction to fail. |
| `--why breaker-tripped` was unreachable | `stop` accepted it and nothing produced it, so a systematically failing run stopped as `queue-drained` — indistinguishable in the report from success. The supervisor now routes retries through `gstack-failure-count`: BREAK on an item parks it, BREAK on the run stops with `breaker-tripped` (`a5d283f9`). Verified by mutation: removing the path from the doc fails the new test. |
| No way to release a claim mid-pipeline | `release --worker` frees an item the caller actually holds (exit **24** otherwise), and `claim` hands that same item to the next worker (`340b73b6`). The release is recorded in `queue.jsonl` symmetrically with the claim. Previously the only exits were `done`, `park`, or waiting out the two-hour TTL. |

## Deferred — real, non-blocking

| Item | Detail |
|---|---|
| `atomic_write_json` uses a fixed `.tmp` name | Two concurrent `stop` calls on one run share the temp filename and could interleave. |
| A corrupt lock file can be released by nobody | `cmd_release` sets `holder = None` on any parse exception and then compares it to `--worker`, so no name matches and only the 2-hour TTL recovers it — the wait `release` was built to remove. Fails in the safe direction (never hands in-flight work to a second worker), so it is deferred rather than fixed. |
| Every error message renders `?` on a Windows console | All ~30 operator-facing messages use an em-dash. Under PowerShell/conhost the dash comes out as a replacement character, which is where these messages are actually read. The fix is an encoding decision (reconfigure stderr vs. ASCII-only prose), and which one is right cannot be verified from an MSYS shell — its output pipeline is not the founder's terminal. Needs one check in conhost before choosing. |
| Wrong-shaped JSON raises KeyError | `open_items` and `cmd_report` index `rec["item_id"]`/`rec["event"]` unguarded, so a line that is valid JSON of the wrong shape produces a raw traceback (exit 1) rather than a deliberate code. |
| **A parked approval request cannot be corrected once written** | The founder's list can go stale and nothing can fix it. Verified: after `park`, a second `park` with a corrected action is exit 8; `resolve --decision declined` does not return the item to the open set, so a re-park is still exit 8 and `claim` returns exit 4. This bit the run that found it — item `2b7045702f` is parked asking approval to push *three* commits, and two more landed afterwards, so the string now understates what approving it would do. The gate built this turn cannot catch it: the text was accurate when written. The fix needs a founder-visible semantics decision (does an amended request reset a decision already made?), which is why it is recorded rather than guessed at. |
| `park`'s field gate runs before its corrupt-queue check | A corrupt `queue.jsonl` plus a thin `--action` reports 22 rather than 11, so the operator hears the narrower problem first and learns of the corruption on the retry. Both paths refuse and neither writes to `parked.jsonl`, so no false approval is created. Cosmetic; the one new order-dependency beyond the intended `--verdict` move. |
| `park --action`'s floor of 10 rejects real terse actions | `deploy`, `approve` and `git push` are all refused, and the first two were the literal values in this repo's own tests. Padding to clear the floor adds no information, which is the vacuity limit the gate already documents. Fails closed, so it is friction. Lowering to ~8 is a judgement call; 10 is defensible while `--reason` carries the explanation. |
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
