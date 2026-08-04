# Thin Orchestrator — The Controller Does Not Edit

## The rule

When acting as orchestrator, the controller does NOT edit source files. It
decomposes a job into units, dispatches a subagent per unit, reads their
reports, and updates shared state. Editing is delegated even when the edit
looks trivial. **"It's one line" is the rationalization that collapses the
separation** — see "Rationalizations and their counters" below before you
act on it.

## Why

Two independent benefits, not one:

1. **Context stays clean.** A long session degrades as more tool output piles
   into it — half-read diffs, failed attempts, other files' contents that
   were never relevant to the current decision. If the controller never
   edits, none of that noise lands in its context; only subagents' short,
   structured reports do. A session that stays orchestrator-only can run far
   longer before quality drops.
2. **The coordinator can't grade its own work.** This is the same conflict of
   interest `references/independent-verification.md` names for verification:
   the agent that wrote a change is the worst-positioned agent to find what's
   wrong with it, because it already believes its own reasoning. An
   orchestrator that edits one file itself and then reads that file's own
   report is not independent of the thing it's judging, even if a different
   nominal "step" reads the report.

Both benefits require the SAME discipline — zero orchestrator edits, not
"edits kept small." A small edit still corrupts both benefits: it still
lands implementation reasoning in the controller's context, and it still
means the controller graded work it did itself.

## Enforcement: this is a reminder, not a hard gate

Be precise about what actually stops an orchestrator from editing, because an
overstated enforcement claim is worse than an honestly-stated rule — a reader
who believes a claim is enforced stops watching for the failure.

`delegate/SKILL.md` omits `Edit` and `Write` from its `allowed-tools` list.
That omission is a reminder, not a security boundary: `allowed-tools` is
checked against tool-name strings, not against what a permitted tool does.
`delegate` still needs `Bash` for dispatch, verification, and state-recording
commands, and `Bash` can write files exactly as well as `Edit` can (`echo ...
> file`, `sed -i`, `python -c "open(...).write(...)"`, `git apply`). Nothing
in the frontmatter stops that route.

The mechanism that actually blocks a tool call in this harness is a
`PreToolUse` hook returning `permissionDecision: "deny"`. `freeze/SKILL.md`
implements exactly this — it hooks `Edit` and `Write`, checks the target path
against a saved boundary, and denies the call if it falls outside. `freeze`'s
own Notes say the honest version of this same limitation for its case: "This
prevents accidental edits, not a security boundary — Bash commands like `sed`
can still modify files outside the boundary." `/delegate` does not ship a
matching `PreToolUse` hook by default, so its no-edit rule is discipline
backed by a loud reminder, not a structural guarantee. Anyone who wants a
real gate instead of a reminder should copy `freeze/SKILL.md`'s hook pattern
rather than trust the `allowed-tools` omission alone.

## Waves

Group dispatched units by dependency, not by convenience:

- Units with no shared files and no ordering constraint between them form one
  **wave** and are dispatched concurrently.
- A unit that consumes another unit's output (reads a file the other unit
  writes, or needs it to exist first) belongs to a **later** wave.
- Run shared pre-commit or lint hooks ONCE PER WAVE, after all units in that
  wave report done — not once per agent — to avoid lockfile contention from
  multiple agents fighting over the same hook run.

### FILE-SCOPE RULE

Waves are defined by file scope, not by how independent the units *look*.
**Two units in the same wave must never be able to write the same file.** If
they could — even if in practice they'd write non-overlapping regions of it —
they belong in different waves. This is a stricter rule than "don't assign
overlapping work"; two units can have completely disjoint responsibilities
and still collide if their file-scope declarations overlap.

## Worked example: three routes, one barrel file

**Job:** add three new admin API routes — `/admin/users`, `/admin/orgs`,
`/admin/audit-log` — each in its own handler file, each registered in the
app's shared router index, each documented in the shared OpenAPI spec, plus a
test file per route.

**Decomposition, with file scope stated up front (do this before dispatching
anything):**

| Unit | Creates | Also writes |
|---|---|---|
| A: users route | `routes/admin/users.ts` | `routes/index.ts` (register), `openapi.yaml` (add entry) |
| B: orgs route | `routes/admin/orgs.ts` | `routes/index.ts` (register), `openapi.yaml` (add entry) |
| C: audit-log route | `routes/admin/audit-log.ts` | `routes/index.ts` (register), `openapi.yaml` (add entry) |
| D: users tests | `routes/admin/users.test.ts` | — |
| E: orgs tests | `routes/admin/orgs.test.ts` | — |
| F: audit-log tests | `routes/admin/audit-log.test.ts` | — |

**The trap:** at first glance, A, B, and C look like the textbook case for one
concurrent wave — three unrelated routes, three different engineers would
grab one each without a second thought. They are NOT independent by the
file-scope rule: all three write `routes/index.ts` and `openapi.yaml`. Two
subagents editing the same file concurrently is a lost-write race — whichever
finishes last wins, and the other's registration silently disappears. Nothing
about the failure is loud; the route file compiles, the router just never
mounts one of the three routes.

**Correct waves:**

- **Wave 1:** Unit A alone. (Creates `users.ts`, edits `routes/index.ts` and
  `openapi.yaml`.)
- **Wave 2:** Unit B alone, dispatched only after Wave 1 reports done — it
  edits the same two shared files A just changed.
- **Wave 3:** Unit C alone, same reason.
- **Wave 4:** Units D, E, F together, concurrently. Each writes exactly one
  test file, and no two of them touch the same path — this is the one point
  in the job where three units are genuinely file-disjoint and belong in the
  same wave. (D also depends on A having created `users.ts` first, which Wave
  1 already satisfies by the time Wave 4 runs.)

Four waves, not two, because the shared-file writes in A/B/C force
serialization that their superficial independence hides. The test units in
Wave 4 are the actual positive case for concurrency — use them as the
contrast: same job, same file-count-per-unit, opposite scheduling, because
their file scopes don't overlap.

### The sharper fix: re-cut the units instead of serializing

Serializing A/B/C into three waves works, but it isn't the first thing to
try — it's the fallback for when a shared-file edit can't be pulled apart.
Try RE-DECOMPOSITION first: split the "register in `routes/index.ts` and
`openapi.yaml`" work out of each route unit and give it to a new unit of its
own.

| Unit | Creates | Also writes |
|---|---|---|
| A′: users route | `routes/admin/users.ts` | — |
| B′: orgs route | `routes/admin/orgs.ts` | — |
| C′: audit-log route | `routes/admin/audit-log.ts` | — |
| G: register + document | — | `routes/index.ts` (all three entries), `openapi.yaml` (all three entries) |

With the shared-file edit isolated into unit G, the waves collapse to two
instead of four:

- **Wave 1:** A′, B′, C′ concurrently — none of them touches a shared file
  anymore, only its own new handler file.
- **Wave 2:** G alone, once Wave 1 reports done — it reads what A′/B′/C′
  created and writes the two shared files in one pass, so there is only ever
  one writer of `routes/index.ts` and `openapi.yaml` for this job.
- **Wave 3:** D, E, F concurrently, same as before.

Re-cutting turned three sequential single-unit waves into one three-way
concurrent wave plus one small registration unit — strictly better than
serializing, for the same total work. Reach for this first; only serialize
(as in the four-wave version above) when the shared-file edit genuinely
can't be isolated into its own unit — for example, if each route's
registration required route-specific logic in `routes/index.ts` that
couldn't be expressed as "append an entry."

## When NOT to use this pattern

- **Single-file edits.** If the whole job touches one file, there is nothing
  to wave and nothing to gain from a dispatch/verify round trip — just make
  the edit directly, outside `/delegate`.
- **Conversational answers.** Answering a question, explaining code, or
  summarizing a diff is not a build job. Don't wrap it in an orchestrator
  role it doesn't need.
- **Jobs where dispatch overhead exceeds the work.** Briefing a subagent with
  enough domain context to do a two-minute fix correctly can itself take
  longer than doing the fix. If decomposition, dispatch, and independent
  verification together cost more than the job is worth, do the job directly
  instead of performing the pattern for its own sake.

State this explicitly to whoever is deciding whether to invoke `/delegate` —
a pattern that never says "don't use me here" gets reached for reflexively,
on jobs too small to need it, which just adds latency without adding safety.

## Rationalizations and their counters

An orchestrator mid-job will generate its own reasons to make "just this
one" edit. Naming them in advance is the only way to make the no-edit rule
survive contact with a plausible-sounding exception.

| Rationalization | Why it sounds reasonable | Why it's wrong | Counter |
|---|---|---|---|
| "It's one line." | Small edits seem low-risk, not worth a whole dispatch. | Risk was never the reason for the rule — context contamination and self-grading are. A one-line edit still lands implementation reasoning in the controller's context and still makes the controller the one grading its own change. | Dispatch it anyway. Size is not an exemption; the brief can say "this is a one-line change" so the subagent moves fast, but the controller still doesn't touch the file. |
| "Dispatching costs more than doing it myself." | Sometimes true — round-trip latency is real. | If it's actually true, the job never should have entered `/delegate` in the first place — see "When NOT to use this pattern." Deciding this mid-job, after already committing to the pattern, is a scope change disguised as an efficiency call. | If the overhead genuinely exceeds the work, stop, exit the orchestrator role, and say so out loud — then do the edit directly, outside `/delegate`. Don't quietly break the rule while still claiming to run under it. |
| "I already know exactly what this file needs — writing it myself avoids losing that precision in translation." | Feels like the controller has the clearest picture of the fix. | That precision is exactly what belongs in the subagent's brief, not in the controller's own hands. If the controller can state precisely what's needed, it can state it precisely to a subagent. | Put that exact precision into the unit's brief word for word. The subagent executes it; the controller still never opens Edit/Write. |
| "This edit is just fixing something a subagent got wrong — it's basically a correction, not new work." | Correcting a subagent's mistake feels like oversight, not authorship. | A correction is still an edit made by the agent that will then judge whether the job succeeded. It reintroduces the exact conflict of interest the pattern exists to remove. | Dispatch a new unit: "subagent's output at `<path>` has `<specific defect>` — fix it." Let a subagent (the same one or a fresh one) make the correction, then verify independently as usual. |

**The trip-wire:** if you are acting as the orchestrator and you find yourself
about to call `Edit` or `Write`, stop. That is not a judgment call to weigh —
it is a signal that a unit was missed during decomposition. Go back to
DECOMPOSE, name the unit, and dispatch it. `delegate/SKILL.md`'s frontmatter
omits `Edit` and `Write` from `allowed-tools` as a loud version of this same
reminder — see "Enforcement: this is a reminder, not a hard gate" above for
why that omission is not itself what stops you; the discipline is what stops
you, backed by a reminder, not by a gate this skill ships today.
