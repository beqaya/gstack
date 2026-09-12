# ACE Reflector — what was built, and what is still open

Date: 2026-09-12
Status: built and tested on `feat/ace-reflector`. One item needs a founder
decision before the loop runs at all.

## Why this exists

`bin/gstack-playbook` already implements two of ACE's three roles (arXiv
2510.04618): skills generate, and `approve` curates. The Reflector — the role
that distills a lesson out of what happened — was left to prose. That
instruction is emitted into every generated SKILL.md, all 57 of them, and in
seven weeks it produced **three bullets across two skills**.

The same failure was already diagnosed once. `bin/gstack-skill-usage` opens with
it: usage used to be recorded by prose in six SKILL.md files, and two skills out
of sixty had ever recorded a use. The fix was to replace the instruction with a
hook. Coverage of the instruction was never the constraint — asking a model to
remember is.

## What was built

`bin/gstack-reflect-collect` — a `PostToolUseFailure` hook. Records a bounded,
redacted record of what failed: tool, target, error text, cwd, and the skill the
session last invoked. Proposes nothing. Fails OPEN on every path, matching the
observer/guard asymmetry the skill-usage recorder states.

`bin/gstack-reflect` — the distiller. Groups evidence by skill and by a
normalized error signature (line numbers, hex addresses and absolute paths
removed, since they differ on every occurrence of the same problem), and proposes
a bullet for anything seen twice or more. Proposals go through
`gstack-playbook add`, so they land PENDING and the Curator gate is untouched.
Dry run by default.

Repetition is the filter. A one-off failure is usually the task; the same failure
twice is a property of how the skill works. Proposing on first sight would bury
the real lessons — the mistake `conventions/verification.md` records about flag
rates, in a different costume.

12 tests in `test/reflect.test.ts`, including that a single occurrence is NOT
proposed, that a dry run writes nothing, that `--apply` is idempotent, and that
a secret in a recorded command is redacted.

## Requires a founder decision

### The hook is not registered, so the collector never fires

`bin/gstack-reflect-collect` is built, tested and correct. It is **not** in
`~/.claude/settings.json`. Until it is, `gstack-reflect` will keep reporting
"the collector has not fired", and the Reflector role remains as absent as it
was before this branch.

Registration modifies `settings.json`, which the founder's CLAUDE.md places
behind an explicit ask. Same shape as the budget guard, which sat unwired for
months for the same reason.

Event: `PostToolUseFailure`. No matcher needed — every failed tool call is
evidence.

## Known gap, accepted deliberately

**Attribution is best-effort.** The collector names the skill by reading the
session's last `skill-usage.jsonl` record, which only exists when the `Skill`
tool was called. A skill that is *followed* by reading its SKILL.md — which the
founder's routing rules ask for — never appears there. `gstack-usage-report`
measured the same hole: `browse`, `autoplan` and the `plan-*` reviews appear in
the project timelines and in no line of `skill-usage.jsonl`.

So most evidence will arrive unattributed. It is recorded anyway and reported
separately rather than dropped, because the failures are real even when the
owner is unknown. Closing this properly means a second attribution source — the
`InstructionsLoaded` hook is the obvious candidate and was not investigated.

## Not done

- No success-side reflection. ACE distills from successes as well as errors;
  this reads only `PostToolUseFailure`. A convergent-workflow signal would need
  a different source, probably `Stop` plus the transcript.
- No model-assisted distillation. Signatures are mechanical, so a bullet reads
  like evidence rather than advice. The Curator gate is what makes that
  acceptable: a human reads it before it enters any skill's context.
