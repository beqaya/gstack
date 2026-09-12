# A5 measured before implementing — and the plan does not survive it

Date: 2026-09-12
Status: STOPPED before the first edit to `preamble.ts`. A5 as specified cannot
meet its own acceptance criteria, and its largest single item is forbidden by an
existing guarantee with a test enforcing it.

Method: parse every generated `*/SKILL.md`, group by `##` heading, and hash each
section body. A heading whose body is byte-identical across every skill that
carries it is shared boilerplate; anything with more than one variant is
skill-specific and cannot move. 56 skills.

## What the measurement says

| | |
|---|---|
| Mean SKILL.md | 58.6 KB, ~15,001 tokens |
| Byte-identical across skills | 28.4 KB per skill |
| Of that, AskUserQuestion Format | 7.7 KB per skill |
| Movable once that is excluded | 20.7 KB per skill |
| Mean after moving it | 37.9 KB, ~9,703 tokens |

The 15,001-token mean independently reproduces the ~14,400 median the
force-multiplier design measured by a different method, which is the reason to
trust the rest of the table.

## Acceptance criteria, against the measurement

- **Criterion 1 — median under 6,000 tokens, from ~14,400: MISSED.** The
  achievable figure is ~9,703. Moving every byte that is provably identical
  across all 56 skills gets 35% of the way, not to the target.
- **Criterion 2 — worst single load under 10,000, from ~26,851: MISSED,
  badly.** The largest SKILL.md is 110 KB; removing 20.7 KB leaves ~22,400
  tokens. The worst case is dominated by skill-specific content, which A5 does
  not touch by construction.

The remaining gap is not boilerplate. It is skill-specific prose, and trimming
that is a different project with different risks.

## Why AskUserQuestion Format cannot move

`test/auq-format-always-loaded.test.ts` exists to prevent exactly this. Its own
docstring names the failure it kills: carving a skill into a skeleton plus
on-demand sections "could strand the AskUserQuestion decision-brief format... The
user would then see an AUQ with no ELI10, no Recommendation, no Pros/Cons —
exactly the degradation we must guarantee never happens."

The guarantee is explicit: every interactive skill carries the FULL format spec
in its always-loaded skeleton, **not only in a section**. A roster of 18 skills
is asserted per-PR, plus 14 mandatory elements each.

That block is 430 KB across the suite and 38% of the movable payload. It is also
the one block a question can fire against at any moment, which is why it was
guarded. This is a deliberate prior decision, not an oversight, so A5's scope
shrinks rather than the guard bending.

Nine further test files carry the same class of always-loaded or carve-safety
assertion, and `test/helpers/carve-guards.ts` is a shared module for them. The
A5 plan and the carve-guard regime were written against each other; that tension
needs a founder decision, not a quiet resolution in a refactor.

## Corrections to the force-multiplier design's inventory

The design doc lists these as shared blocks to move. Measured, they are
per-skill and cannot:

- **Question Tuning**, listed at 2.6 KB shared — **41 distinct variants**.
- **Preamble (run first)**, listed at 4.5 KB shared — **46 distinct variants**.

## Blast radius, if it proceeds anyway

50 assertions across 15 test files reference the movable headings, including
three golden fixtures (`test/fixtures/golden/*-ship-SKILL.md`) that are full
expected outputs and would need wholesale regeneration.

A baseline hash of all 56 generated files was captured before any edit, so a
regeneration can be proved to change only the moved sections.

## The sequencing problem

Moving content from a file the agent already has open into a file it must choose
to read is a behavioural change across 56 skills. Whether the model actually
reads the pointer cannot be verified by any test in this repo — it needs the
eval harness, which is item 3 and requires Claude Code 2.1.269.

So item 3 is the instrument for item 2. Doing A5 first ships an unverified
behavioural change to every skill.

---

## DROPPED — founder decision, 2026-09-12

A5 is not being built. Two reasons, in order of weight:

1. It misses both acceptance criteria it was written for (~9,703 tokens against
   a target under 6,000; ~22,400 against 10,000 worst-case), and its largest
   single block is protected by `test/auq-format-always-loaded.test.ts`, a guard
   written deliberately to stop exactly this move.
2. The catalog mode decision taken the same day makes skill loads **heavier**,
   not lighter: full mode restores every "Use when asked to…" trigger to the
   frontmatter, at ~7,581 token-equivalents of always-loaded discovery surface
   against trim's ~1,218. A5 would recover roughly a third of one skill load
   while the suite deliberately spends more, because routing accuracy was worth
   more than the tokens.

Reopen only if a session dies on context again. The measurement in this file
stands and the baseline hashes were captured, so a future attempt starts from
evidence rather than from the original estimate.
