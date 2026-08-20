---
name: delegate
version: 1.0.0
description: |
  Runs a multi-step job as a thin orchestrator that never edits files itself --
  decomposes the job into units, groups units into waves by FILE SCOPE (two
  units that could write the same file never share a wave), dispatches one
  subagent per unit, has a DIFFERENT agent independently verify each completed
  unit per references/independent-verification.md, then reports what shipped,
  what failed, and what is still unverified. The controller's own tool access
  omits Edit and Write as a loud reminder, not a hard gate -- this harness's
  actual enforcement mechanism is a PreToolUse hook (see references/thin-orchestrator.md
  and freeze/SKILL.md), which /delegate does not ship by default. Not for everything:
  skip this for single-file edits, conversational answers, or any job where
  dispatch overhead would exceed the work itself -- see
  references/thin-orchestrator.md "When NOT to use this pattern". Use when
  asked to "delegate this", "run this as an orchestrator", "fan this out", or
  for any job with 3+ independent units of work. (gstack)
triggers:
  - delegate this
  - run this as an orchestrator
  - fan this out
  - dispatch waves
  - thin orchestrator
allowed-tools:
  - Agent
  - Read
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
---

# /delegate -- Thin Orchestrator: Decompose, Dispatch, Verify, Never Edit

You are the controller for this job, not an implementer. Read
`references/thin-orchestrator.md` before your first dispatch if you have not
already -- it carries the full rationale, the waves worked example, and the
rationalization table this skill's HARD CONSTRAINT below depends on.

**Notice what is missing from this skill's `allowed-tools` above: `Edit` and
`Write`.** That is deliberate, not an oversight. The no-edit rule is not only
written down here -- it is backed by the tool list you were given for this
run. If your harness enforces `allowed-tools` per skill invocation, you
structurally cannot make an edit while running `/delegate`; if it does not,
treat the omission as the loudest possible reminder that reaching for Edit or
Write right now is the violation this skill exists to prevent.

## Enforcement: this is a reminder, not a hard gate

Be honest with yourself about what the missing `Edit`/`Write` entries
actually buy you: omitting them from `allowed-tools` is a reminder, not a
security boundary, and `allowed-tools` is only ever checked against
tool-name strings -- nothing in this harness inspects what a permitted tool
is used for. `Bash` is still on this skill's `allowed-tools` list, because
dispatch, verification, and state-recording all need it -- and `Bash` can
write files just as well as `Edit` can (`echo ... > file`, `sed -i`,
`python -c "open(...).write(...)"`, `git apply`). Nothing about the frontmatter
stops that.

The mechanism that actually blocks a tool call in this harness is a
`PreToolUse` hook returning `permissionDecision: "deny"` -- see
`freeze/SKILL.md`, which implements exactly this for Edit/Write outside a
directory boundary, and says so plainly in its own Notes: the boundary
"prevents accidental edits, not a security boundary -- Bash commands like
`sed` can still modify files outside the boundary." `/delegate` does not
ship a matching hook by default, so its no-edit rule is discipline backed by
a loud reminder, the same category of protection `freeze` describes for its
own Bash gap -- not a structural guarantee. If you want a real gate instead
of a reminder, `freeze/SKILL.md`'s `PreToolUse` hook is the working example
to copy.

## User-invocable

When the user says "delegate this", "fan this out", or hands you a job with
several independent units of work, run this skill against that job.

---

## Step 0: Agent Teams preflight (do this FIRST)

Check whether Claude Code's experimental Agent Teams is enabled:

```bash
if [ -n "$CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ]; then echo TEAMS_ON; else echo TEAMS_OFF; fi
```

- **TEAMS_OFF** (the common case): proceed normally. Each `Task`/subagent
  dispatch below returns its result to you when it finishes, and you wait on
  that result to verify and record it.
- **TEAMS_ON**: STOP and tell the user before dispatching. With teams enabled,
  a named subagent silently becomes an independent *teammate* rather than a
  child that returns to you, so this skill's wait-on-result → verify → record
  loop stalls: the orchestrator waits for a return that never comes. Either
  (a) run this job in a session without the flag, or (b) if the user wants the
  teams substrate, drive the work through the shared task list with a
  `TaskCompleted` hook running the independent-verification pass (exit 2 to
  block an unverified completion) instead of this skill's inline dispatch.
  Do not silently fall through — the failure looks like a hang, not an error.

## Step 1: DECOMPOSE

List every unit of work. For each unit, name the specific file(s) it will
create or write. Do this for ALL units before dispatching anything -- you
need the full file-scope picture to build correct waves in Step 2, and a unit
discovered mid-run after dispatch has already started is a sign Step 1 was
incomplete.

If you cannot name a unit's file scope in one line, you don't understand the
unit well enough to dispatch it yet -- go find out (read the relevant code,
ask the user) before continuing.

## Step 2: WAVE

Group units so that **no two units in the same wave can write the same
file.** This is a stricter test than "these look unrelated" -- see the
routes/barrel-file worked example in `references/thin-orchestrator.md` for a
case where three superficially independent units turn out to share two files.

When units collide on a file, try RE-DECOMPOSITION first, not serialization.
Ask whether the shared-file edit can be pulled out into its own unit that
runs after the colliding units hand it their pieces -- in the routes
example, splitting out a separate "register + document" unit that runs after
A/B/C lets the three route units run concurrently in wave 1, instead of
forcing all three into sequential waves. Only fall back to serializing the
colliding units into separate waves when the shared-file edit genuinely
can't be split out on its own (see `references/thin-orchestrator.md` for
both the serialized version and the re-cut version side by side).

State the waves and their contents -- unit, files, and which prior wave (if
any) it depends on -- before dispatching a single subagent. This is a
checkpoint: if stating the waves out loud reveals a file collision you
missed, fix the grouping now, not after two agents have already raced.

## Step 3: DISPATCH

One subagent per unit. Each subagent's brief must carry:

- The specific task, in enough detail that the subagent doesn't have to
  reconstruct intent from the wider job.
- The domain facts it needs to do the work correctly (not just "fix the
  bug" -- what the bug actually is, which file is authoritative, what
  "correct" looks like here).
- Its file scope, stated explicitly: which file(s) it may write, and
  (implicitly, from Step 2) that nothing else in this wave will touch them.

Use a cheap model for mechanical, well-specified units. Dispatch all units in
a wave together; wait for the whole wave to report before starting the next
one, since later waves may depend on files this wave just created or changed.

Run any shared pre-commit or lint hook once per wave, after all of that
wave's units report done -- not once per subagent -- to avoid lockfile
contention between concurrent agents.

## Step 4: VERIFY

A DIFFERENT agent than the one that did the work checks each completed unit.
Follow `references/independent-verification.md` for how to brief that
verifier -- re-derive from primary sources (re-run the command, re-read the
file from disk, re-query the live object), never read the implementer's
report and concur, and carry the domain facts the verifier needs to hunt
untested failure modes rather than rubber-stamp what was easy to check. Use a
capable model for this pass; verification is the harder half of the job, not
the cheaper half.

## Step 5: STATE

After each wave completes and is verified, record progress where the caller
specified. If a shared tracker file is in play and more than one session
might be writing it, use `/session-lock` around that write rather than
writing it directly.

## Step 6: REPORT

Report what shipped, what failed, and what is still unverified. Never claim
success for a unit whose independent verification did not return a passing
result -- an unverified unit is reported as unverified, not folded silently
into "done."

---

## HARD CONSTRAINT: the orchestrator makes no edits of its own

While acting under `/delegate`, you do not call `Edit` or `Write`, ever, for
any reason. If you find yourself about to make one, that is not a judgment
call -- it means a unit was missed during DECOMPOSE. Stop, go back to Step 1,
name the missing unit, and dispatch it instead.

This holds under every rationalization that will occur to you mid-job,
including these four -- the full counter for each is in
`references/thin-orchestrator.md`'s "Rationalizations and their counters"
table, read it before you act on any of them:

- *"It's one line."* Size was never the reason for the rule; a one-line edit
  still contaminates the controller's context and still makes it the grader
  of its own work. Dispatch it anyway.
- *"Dispatching costs more than doing it myself."* If that's true, this job
  should not have entered `/delegate` in the first place -- see "When NOT to
  use this pattern" below. Realizing that mid-job means stopping and saying
  so, not quietly breaking the rule while still claiming to run under it.
  Waves already completed and verified before you stopped are still reported
  per Step 6 as shipped and verified; whatever you do next outside the
  pattern still needs its own independent verification before it can be
  reported as done -- exiting the role doesn't exempt the remaining work from
  Step 4.
- *"I already know exactly what this needs."* Then you can state it exactly
  in the subagent's brief. Precision belongs in the brief, not in your own
  hands on the keyboard.
- *"This is just correcting a subagent's mistake."* A correction is still an
  edit made by the same agent that will judge whether the job succeeded.
  Dispatch the fix as its own unit and verify it independently like any
  other.

## When NOT to use this pattern

Do not reach for `/delegate` on:

- **Single-file edits** -- nothing to wave, no benefit from a dispatch/verify
  round trip.
- **Conversational answers** -- explaining code or answering a question is
  not a build job.
- **Jobs where dispatch overhead exceeds the work** -- if briefing a subagent
  with enough context to do a two-minute fix correctly would itself take
  longer than the fix, do it directly instead of performing the pattern for
  its own sake.

Full detail and the worked wave-decomposition example are in
`references/thin-orchestrator.md`.

---

## Output

Report, per wave: units dispatched, verification verdicts, and state
recorded. End with a summary: what shipped (verified), what failed, what is
unverified. An unverified unit is never described as shipped.
