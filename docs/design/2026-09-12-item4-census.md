# Subagent delegation in run-supervisor — censused, and not worth building yet

Date: 2026-09-12
Status: NOT BUILT. The loop it would optimise has not run in a month, so there
is no context cost to save. The census found a different problem that matters
more.

## Why a census came first

Every item in this programme that was measured before implementation came back
different from its spec. A5 missed both acceptance criteria. The routing
hypothesis was wrong twice — the descriptions were not thin, and
`plan-design-review` passed when it was predicted to miss. Item 4 arrived as a
design argument with no number attached, so it got the same treatment.

The gating question: does `run-supervisor` actually accumulate the context that
delegation would move into a subagent?

## What the run state says

`~/.gstack/runs` holds every run the supervisor has ever executed.

| Run | Status | Queue | Journal | Parked |
|---|---|---|---|---|
| 17ca8cafe958 | **active** | 2 | 1 | 0 |
| 4b7d8fd156dc | stopped | 6 | 2 | 0 |
| 7b69faa11c76 | stopped | 6 | 2 | 0 |
| 9a5f7d592b1d | stopped | 15 | 4 | 2 |
| caf5a03d4c1a | stopped | 6 | 7 | 3 |
| f0b236074d70 | **active** | 5 | 1 | 0 |

Six runs, 40 queued items, **17 journal entries in the loop's entire lifetime**.
Every one was created between 8 and 13 August. Nothing since.

The work was real, not smoke tests — the journal claims are substantive and
about the supervisor's own hardening: `read_manifest` exit codes, per-call
unique temp names in `atomic_write_json`, structural refusal of
self-verification, a circuit-breaker path that emits `stop --why breaker-tripped`.

So the loop works. It was used to build itself, once, and then stopped.

## Conclusion on item 4

Delegating a stage to a subagent saves the worker's context. A worker that has
processed 17 items across five days a month ago has no context problem to solve.
Two days of work would buy an improvement nobody can currently measure, on a
code path nobody is currently running.

Item 4 is parked, not cancelled. The trigger to revisit it is simple and
falsifiable: **a run whose journal exceeds ~20 entries, or a worker that stops
with `--why budget-exhausted`.** Either means the loop is doing enough work for
its context to matter. Neither has happened.

## What the census found instead

**Two runs are still marked `active`.** `17ca8cafe958` ("Sub-project D: measure
what the runs already...") and `f0b236074d70` ("B: first real improvement
cycle") were abandoned mid-run and never stopped, so no `resume.json` was
written and the manifests still claim work is in flight. This is precisely the
consequence the core-runtime followups predicted for an unwired budget guard:
"when the session dies there is no `stop` at all: no `resume.json`, and the
manifest stays `active`." The guard is wired now; these two runs predate it.

**The self-improvement loop's first cycle never finished.** `f0b236074d70` is
named "B: first real improvement cycle" and journaled one entry. That, not
context efficiency, is what stands between gstack and the self-enhancement loop
sub-project B describes.

**One journal has no tier.** All four entries in `9a5f7d592b1d` carry
`tier: None`, though Step 5 asks for the tier from Step 3 to be passed through.
Either the flag was omitted four times or it was not enforced.

**One UNPROVEN verdict is unresolved** in `caf5a03d4c1a`: "the reject_thin gate
and release command fix both reported defects". Nothing in the journal closes it.

## Recommended instead of item 4

Close the loop's own open state before optimising it: resolve or stop the two
abandoned runs, settle the UNPROVEN entry, and find out why the tier was absent.
That is a few hours, it uses the machinery as intended, and it is a precondition
for any future run being worth censusing.
