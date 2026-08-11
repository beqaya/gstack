# Taking gstack to the next level — A, then B, then C

Date: 2026-08-11 (revised same day, after the first draft's central measurement
turned out to be the wrong one)
Status: A is specified to implement. B and C are designs whose open decisions are
named rather than guessed, because they depend on data A produces.

## The decision that scopes everything

**gstack is a personal force-multiplier.** Founder's call, 2026-08-11. It exists
to make one person faster on Lezam and consulting work. Nobody else installs it.

## The correction this document exists because of

The first draft opened with a frightening number: 880,000 tokens of skills, 59%
of it duplicated. It proposed a diet against that number.

**That number is never loaded.** Measuring what actually enters a context window
gives a different picture, and a different plan:

| What | Tokens |
|---|---|
| Suite on disk | ~880,000 — never all loaded |
| Loaded every session (all 60 descriptions) | ~1,600 |
| Loaded per skill invoked, median | ~14,400 |
| Loaded per skill invoked, worst (`design-review`) | ~26,851 |
| Of a skill load, shared protocol | ~9,000 |

Two conclusions follow, and both contradict the first draft.

**Archiving unused skills saves almost nothing.** All sixty descriptions together
cost ~1,600 tokens. Archiving thirty skills would save ~800 — less than one
paragraph of a reply. "An unused skill is rent" was wrong; skills only cost when
they load. The instrumentation in A2 is still worth building, but for routing
accuracy and improvement targeting, not to reclaim space.

**Skills are not where context goes.** Measured across this project's own working
session:

| Consumer | Tokens | Share |
|---|---|---|
| Tool calls | 414,000 | 42% |
| Tool results | 247,000 | 25% |
| User text and injected listings | 189,000 | 19% |
| Assistant replies | 134,000 | 14% |

Two thirds is tool traffic. Skill loading lives inside the 19%. A protocol diet
that saves ~27,000 tokens on a session that spent 660,000 on tool traffic fixes
about 4% of the problem while feeling like the main event.

## What survived the correction

The protocol duplication is real, and worth removing:

| Block, present in all 60 skills | Size each |
|---|---|
| AskUserQuestion Format | 10.0 KB |
| Artifacts Sync | 5.2 KB |
| Preamble | 4.5 KB |
| Skill Invocation During Plan Mode | 3.8 KB |
| Question Tuning | 2.6 KB |
| Skill routing, Context Recovery, First-run, Voice, Telemetry | ~9 KB |

~35 KB per skill, none of it about that skill — about 9,000 tokens of every skill
load. Removing it cuts a median load from ~14,400 to under 6,000.

The quadratic growth claim also survives, but smaller than first stated: only the
~2.2 KB routing block scales with skill count. The other ~33 KB is constant.

**gstack still cannot tell which skills earn their keep.** Usage is recorded by
prose inside six SKILL.md files, so it fires only when a model remembers to. Two
skills have ever recorded a use.

## Sequencing

**A → B → C**, with A itself reordered so the cheap independent wins land before
the expensive one, and so the expensive one is aimed by measurement rather than
by the assumption that just failed.

---

# A — Route, instrument, measure, then diet

## A1. Routing becomes a table (first: cheap, independent)

`bin/gstack-route --intent "<phrase>"` resolves one skill from a lookup table —
the pattern already proven twice here, in `gstack-pipeline` and
`gstack-risk-classify`. Judgement about which skill fits drifts when a model
improvises it fresh each time; a table does not.

Exit 0 with the skill name, 2 for no match (listing near misses), 3 for ambiguity.

This attacks "wrong skill fires" directly and depends on nothing else. The
concrete case it kills: "do security testing" currently has a plausible claim
from `/cso`, `/security-review` and `/pentest`, and picking wrong costs a full
skill load — up to 26,851 tokens — before the mistake is visible.

## A2. Instrument all 60 automatically

Delete the prose-triggered recorder. Replace it with one `PostToolUse` hook
matching the `Skill` tool, appending `{skill, ts, session}` to
`~/.gstack/analytics/skill-usage.jsonl` via a new `bin/gstack-skill-usage`.

Coverage goes 6/60 to 60/60 and cannot be forgotten, because no model is asked to
remember it.

**This hook fails OPEN**, unlike the budget guard which fails closed. The
asymmetry is deliberate and must stay: a lost telemetry record costs one data
point; a telemetry bug that blocks a skill costs the founder's work. Guards on
irreversible resources fail closed; observers fail open.

## A3. Census the real context consumers (the gate on A4 and A5)

Before optimising, measure — the discipline the first draft skipped. A
`bin/gstack-context-census` reads a session transcript and reports tokens by
consumer: tool calls, tool results, skill loads, replies, injected listings, and
within tool traffic, which specific tools.

This is cheap: the measurement above was produced in one pass over the transcript
and can be made repeatable in an afternoon.

**A4 and A5 are sized by what it finds.** If tool traffic dominates as it did in
the measured session, A4 is worth more than A5 and should be built first.

## A4. Tool-output discipline (scope set by A3)

The candidates already visible, each observed in the measured session:

- Full test-suite output where a filtered summary carries the same information.
  Raw output is several hundred lines; filtered, three.
- `git status` printing 52 filenames when the answer needed was a count.
- `./setup` emitting its entire log when only a pass/fail line mattered.
- Whole-file reads where a targeted range was enough.

The fix is not "print less" as advice — that is prose, and prose does not hold.
It is defaults in the tooling: gstack's own `bin/` commands emit summaries with
detail behind a flag, matching how `gstack-metrics` already reports.

## A5. Shared protocol loads once per session, not once per skill

Move the ten shared blocks into `protocol/SESSION-PROTOCOL.md`. Each generated
SKILL.md carries a pointer instead. The first skill invoked in a session reads
the protocol; later skills skip it, gated on a sentinel file beside the one the
preamble already touches at `~/.gstack/sessions/$PPID`.

**Implement this in the generator, not in 60 templates.** This is the load-bearing
decision and it is unchanged from the first draft. `SKILL.md.tmpl` files are
upstream's; editing all 60 would guarantee a conflict in every one of them on
every future `git merge upstream/main`. Changing `scripts/gen-skill-docs.ts` plus
adding one file keeps the conflict surface at two files.

Honest sizing: a session loading three skills goes from ~43,000 tokens of skill
weight to ~16,000. Useful. Not the thing that stops sessions dying.

## A acceptance criteria

Each is falsifiable and needs no judgement call.

1. **Tokens loaded per skill invocation**: median under 6,000, from ~14,400.
   (The first draft measured suite size on disk, which is not context cost and
   can be satisfied by trimming prose nobody loads.)
2. Worst-case single skill load under 10,000 tokens, from ~26,851.
3. Invoking any of the 60 skills produces a usage record. Verified by invoking a
   sample across the range, not by inspecting the hook.
4. The routing table resolves every skill; no phrase maps to two. Test-enforced.
5. `gstack-context-census` reports a session's consumers, and the top consumer
   after A4 is smaller than it was before.
6. **Adding a 61st skill does not increase what any other skill costs to load.**
   Verified with a fixture skill. This is what proves the quadratic term is gone
   rather than deferred.
7. Full suite green, including the 206 tests passing today.

## A risks

| Risk | Consequence | Response |
|---|---|---|
| Skill invoked with no session preamble | Degraded question formatting | Accept and measure; pointer states what to read |
| Protocol file missing | Skills run, formatting degrades | Fails open by construction |
| Upstream rewrites the generator | Conflict in one file | Smaller than the 60-file alternative |
| A3 finds no single dominant consumer | A4 has no clear target | Then context exhaustion is diffuse, and the honest answer is that no diet fixes it — say so rather than build A4 anyway |

---

# B — The self-enhancement loop (design; open decisions named)

Most of B exists. `gstack-run` provides queue, claims, verdicts, parking and
budget. `run-supervisor` is the worker loop. `gstack-metrics` already emits
findings as work items. B is wiring plus signals that only exist after A.

| Signal A creates | Decision it changes |
|---|---|
| Which skills are invoked, and how often | Which deserve depth |
| Routing misses and corrections | Which table row to add |
| Rework rate per skill | Where a gate would earn its cost |
| Context consumed per skill invoked | Whether a heavy skill justifies its weight |

Note what is absent from that list: "which skills to delete for space." The
measurement above removed that motivation.

**The cycle:** metrics collect, findings become queue items, `run-supervisor`
works the queue unattended, anything needing the founder parks with an action and
a reason.

**Autonomy boundary**, mapped onto the tier system that already exists: skill
prose, routing rows, tests and archiving are routine and reversible with one git
command. Anything touching `bin/`, deleting a skill, or touching prod is elevated
and parks. `gstack-risk-classify` already classifies `bin/` edits as elevated.

**The property that makes autonomy sane:** after every change the loop makes, the
suite runs. Red means revert and park. The loop cannot degrade gstack without
halting itself.

## B open decisions — to settle with A's data

- What "unused" means, now that it drives improvement priority rather than
  deletion.
- Cadence. Weekly is a guess; the right answer depends on how fast findings
  accumulate.
- Token budget per cycle, and behaviour when it runs out mid-item.
- Whether the loop may edit skill prose, or only propose the edit.

---

# C — Quality gates, aimed by data (design; open decisions named)

C attacks rework, which is real: in one session, independent review caught a gate
refusing 65% of legitimate evidence, an upgrade command that would have discarded
86 commits, and a description overflow that took out a whole host.

Gates cost tokens and verification already runs at 0.93 per token of work.
Applied uniformly, C nearly doubles the bill and targets nothing. B says which
skills produce the rework; C gates those.

**C1. `bin/gstack-verify`** — turn `verify-outcome` from prose into an executable
gate taking a claim and an evidence class (browser DOM, HTTP body, command
output, produced artifact), refusing proxy evidence. Same shape as `reject_thin`,
which is mutation-tested and holds.

**C2. Verdicts on skill output.** `gstack-run` gates work items today. A skill
producing a spec, a plan or a deploy should carry the same PROVEN requirement.

**C3. Golden tests for the skills actually used**, which A2 identifies.

## C open decisions

- Which evidence class is mandatory per kind of skill output.
- The rework rate at which a skill earns a gate.
- A target verify-to-work ratio. Lower is not automatically better: the current
  0.93 bought three caught defects in one session.

---

# The two roles

Both as **agent definitions**, not skills. A skill costs up to 26,851 tokens of
the founder's window each time it loads. An agent runs in its own context and
costs the window only its conclusion. Deep, expensive roles belong where they do
not charge rent.

**AI engineer** — architecture and adversarial review. This role, played
informally, produced every consequential finding in the session that motivated
this document, including the correction at the top of it. Formalising it makes
that repeatable instead of dependent on someone remembering to ask.

**Designer** — shapes what a skill asks, what it returns, and whether 60 skills
present as one coherent tool. Also covers Lezam's own UI. The engineer asks
whether it is correct; the designer asks whether it is usable.

---

# Explicitly not in scope

- Packaging, onboarding, or docs for other users. gstack is not a product.
- Rewriting the 60 skills' content. A moves protocol out; it does not edit what
  each skill says about its own job.
- Contributing changes upstream. The fork diverges deliberately.
- Deleting skills to reclaim context. The measurement says the saving is ~800
  tokens for thirty skills.
- New skills. If a capability is missing, that is a finding for B, not a licence.

# How we will know this failed

- **A1 failed** if the wrong skill still fires after the table exists.
- **A2 failed** if any invoked skill produces no record.
- **A3 failed** if it cannot attribute most of a session's tokens to a named
  consumer.
- **A4/A5 failed** if context still runs out at the same point. That would mean
  skill weight and tool output were both wrong targets — which is exactly what
  the first draft of this document assumed without checking, and why the census
  now gates the work rather than following it.
- **B failed** if it generates findings nobody acts on, or churns skills without
  a measurable drop in routing misses or rework.
- **C failed** if the verify-to-work ratio rises without rework falling.
