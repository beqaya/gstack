# Taking gstack to the next level — A, then B, then C

Date: 2026-08-11
Status: A is specified to implement. B and C are designs whose open decisions are
named rather than guessed, because they depend on data A produces.

## The decision that scopes everything

**gstack is a personal force-multiplier.** Founder's call, 2026-08-11. It exists
to make one person faster on Lezam and consulting work. Nobody else installs it.

That settles a question that would otherwise recur: an unused skill is not a
feature for a future user, it is rent charged against a finite context window.

## What was measured first

Every number below came from the repo, not from impressions.

| Measurement | Value |
|---|---|
| Suite | 60 skills, 3.4 MB, ~880,000 tokens |
| Content appearing in >=50% of all skills | 1,997 KB (59%) |
| Content unique to a skill | 1,416 KB (41%) |
| Heaviest single skill | `design-review`, 105 KB, ~26,800 tokens |
| Skills that record their own usage | 6 of 60 |
| Skills that have ever recorded a use | 2 (`careful` 54, `freeze` 23) |
| Executable tools in `bin/` | 85 |
| Skills unmentioned by any test | 6 |
| Verification cost, per token of work | 0.93 (estimated, self-reported) |

Two of these reframe the request.

**gstack cannot tell which of its skills earn their keep.** Usage is recorded by
prose *inside* six SKILL.md files, so it fires only when a model remembers to.
An automated improvement loop optimises what it can measure; today that is 3% of
the surface.

**The suite grows quadratically.** The duplicated 59% is not skill content, it is
protocol — the same blocks stored 60 times:

| Block, present in all 60 skills | Size each |
|---|---|
| AskUserQuestion Format | 10.0 KB |
| Artifacts Sync | 5.2 KB |
| Preamble | 4.5 KB |
| Skill Invocation During Plan Mode | 3.8 KB |
| Question Tuning | 2.6 KB |
| Skill routing, Context Recovery, First-run, Voice, Telemetry | ~9 KB |

About 35 KB per skill, none of it about that skill. Adding skill 61 adds its own
content *and* enlarges the shared block inside the other 60. Today, adding
skills makes gstack worse at using skills.

## Sequencing, and why this order

**A → B → C.** B is the destination the founder asked for. It is second because
an enhancement loop built on today's data would tune the wrong things with
precision — the exact failure sub-project D was specified last to avoid. C is
third because gates cost tokens, verification already runs at 0.93, and B is what
says which skills produce enough rework to deserve one.

---

# A — Diet and instrument (implementable now)

## A1. Shared protocol loads once per session, not once per skill

Move the ten shared blocks into one `protocol/SESSION-PROTOCOL.md`. Each
generated SKILL.md carries a short pointer instead of the blocks. The first skill
invoked in a session reads the protocol; later skills skip it, gated on a
sentinel file.

The machinery exists: the preamble in every skill already touches
`~/.gstack/sessions/$PPID` on start. The sentinel is one more file check beside
it.

**Implement this in the generator, not in 60 templates.** This is the load-bearing
decision. `SKILL.md.tmpl` files are upstream's; editing all 60 would guarantee a
conflict in every one of them on every future `git merge upstream/main`. Changing
`scripts/gen-skill-docs.ts` plus adding one new file keeps the conflict surface
at two files. The fork already carries the cost of divergence — it should not
multiply it by 60.

Break-even is one skill per session. Everything after is saving.

## A2. Instrument all 60 automatically

Delete the prose-triggered recorder. Replace it with one `PostToolUse` hook
matching the `Skill` tool, appending `{skill, ts, session}` to
`~/.gstack/analytics/skill-usage.jsonl` via a new `bin/gstack-skill-usage`.

Coverage goes 6/60 to 60/60 and cannot be forgotten, because no model is asked to
remember it. Same shape as the budget guard, which works.

**This hook fails OPEN**, unlike the budget guard which fails closed. The
distinction is deliberate and must stay: a lost telemetry record costs one data
point; a telemetry bug that blocks a skill costs the founder's work. Guards on
irreversible resources fail closed; observers fail open.

## A3. Routing becomes a table

`bin/gstack-route --intent "<phrase>"` resolves one skill from a lookup table —
the pattern already proven twice here, in `gstack-pipeline` and
`gstack-risk-classify`. Judgement about which skill fits drifts when a model
improvises it fresh each time; a table does not.

Exit 0 with the skill name, 2 for no match (listing near misses), 3 for an
ambiguous phrase.

## A acceptance criteria

Each is falsifiable and needs no judgement call.

1. Total suite size <= 1.8 MB, from 3.4 MB.
2. Heaviest single SKILL.md <= 20,000 tokens, from ~26,800.
3. Invoking any of the 60 skills produces a usage record. Verified by invoking a
   sample across the range, not by inspecting the hook.
4. The routing table resolves every skill; no phrase maps to two. Test-enforced.
5. Full suite green, including the 206 tests that pass today.
6. **Adding a 61st skill increases total suite size by no more than its own
   unique content.** Verified with a fixture skill. This is the criterion that
   proves quadratic growth is actually gone rather than merely reduced.

## A risks, and what happens if they land

| Risk | Consequence | Response |
|---|---|---|
| Skill invoked with no session preamble | Degraded question formatting | Accept and measure; pointer states what to read |
| Protocol file missing or unreadable | Skills still run, formatting degrades | Fails open by construction |
| Upstream rewrites the generator | Conflict in one file | Smaller than the 60-file alternative |
| Size drops but sessions still run out | A solved the wrong problem | Named in the failure criteria below |

---

# B — The self-enhancement loop (design; open decisions named)

Most of B exists. `gstack-run` provides the queue, claims, verdicts, parking and
budget. `run-supervisor` is the worker loop. `gstack-metrics` already emits
findings as work items. B is wiring plus four new signals that only exist after A.

| Signal A creates | Decision it changes |
|---|---|
| Skills not invoked in N days | Archive, reclaiming context |
| Routing misses and corrections | Add a table row |
| Rework rate per skill | Where a gate would earn its cost |
| Context paid vs work delivered | Whether a heavy skill justifies its weight |

**The cycle:** metrics collect, findings become queue items, `run-supervisor`
works the queue unattended, anything needing the founder parks with an action and
a reason. The founder reads a short list, not a dashboard.

**Autonomy boundary**, mapped onto the tier system that already exists rather
than a new one: skill prose, routing rows, tests and archiving are routine and
reversible with one git command. Anything touching `bin/`, deleting a skill
outright, or touching prod is elevated and parks. `gstack-risk-classify` already
classifies `bin/` edits as elevated.

**The property that makes autonomy sane:** after every change the loop makes, the
suite runs. Red means revert and park. The loop cannot degrade gstack without
halting itself.

## B open decisions — to settle with A's data, not before

- What "unused" means. 30 days of no invocation is a guess; A's data will show
  whether usage is bursty enough to make that wrong.
- Archive or delete. Archive is reversible and keeps the routing table honest.
- Cadence. Weekly is a guess; the right answer depends on how fast findings
  actually accumulate.
- Token budget per cycle, and what the loop does when it exhausts it mid-item.
- Whether the loop may edit skill prose at all, or only propose the edit.

---

# C — Quality gates, aimed by data (design; open decisions named)

C attacks rework, which is real: in one session, independent review caught a gate
refusing 65% of legitimate evidence, an upgrade command that would have discarded
86 commits, and a description overflow that took out a whole host.

But gates cost tokens and verification already runs at 0.93 per token of work.
Applied uniformly, C nearly doubles the bill and targets nothing. B says which
skills produce the rework; C gates those.

**C1. `bin/gstack-verify`** — turn `verify-outcome` from prose into an executable
gate taking a claim and an evidence class (browser DOM, HTTP body, command
output, produced artifact), refusing proxy evidence. Same shape as `reject_thin`,
which is mutation-tested and holds.

**C2. Verdicts on skill output.** `gstack-run` gates work items today. A skill
producing a spec, a plan or a deploy should carry the same PROVEN requirement.

**C3. Golden tests for the skills actually used**, which A's instrumentation
identifies. Fixtures already exist for a few.

## C open decisions

- Which evidence class is mandatory per kind of skill output.
- The rework rate at which a skill earns a gate.
- A target verify-to-work ratio. Lower is not automatically better: the current
  0.93 bought three caught defects in one session.

---

# The two roles

Both as **agent definitions**, not skills. A skill costs up to 26,000 tokens of
the founder's window each time it loads. An agent runs in its own context and
costs the window only its conclusion. Deep, expensive roles belong where they do
not charge rent.

**AI engineer** — architecture and adversarial review. This role, played
informally, produced every consequential finding in the session that motivated
this document. Formalising it makes that repeatable instead of dependent on
someone remembering to ask.

**Designer** — shapes what a skill asks, what it returns, and whether 60 skills
present as one coherent tool. Also covers Lezam's own UI. The engineer asks
whether it is correct; the designer asks whether it is usable.

---

# Explicitly not in scope

- Packaging, onboarding, or docs for other users. gstack is not a product.
- Rewriting the 60 skills' content. A moves protocol out; it does not edit what
  each skill says about its own job.
- Contributing changes upstream. The fork diverges deliberately.
- New skills. If a capability is missing, that is a finding for B, not a licence.

# How we will know this failed

Stated now, while it is cheap to be honest.

- **A failed** if suite size drops but sessions still run out of context. That
  would mean skill weight was not the binding constraint and the diet bought
  nothing.
- **B failed** if it generates findings nobody acts on, or churns skills without
  a measurable drop in routing misses or rework.
- **C failed** if the verify-to-work ratio rises without rework falling.

Each is checkable from data gstack already records, which is the standard the
rest of this system is held to.
