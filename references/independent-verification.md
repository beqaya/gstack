# Independent Verification — Why the Fixer Can't Be the Checker

## The rule

Any agent that FIXES or BUILDS something must have a DIFFERENT agent verify
the result. Self-review never substitutes. The agent that wrote the change is
the worst-positioned agent to find what's wrong with it — it already believes
its own fix works, so it re-reads its own reasoning instead of the world.

This is a structural rule, not a diligence rule: it does not say "be more
careful when you review your own work." It says a second, independent agent
must produce the verdict, because carefulness does not fix the conflict of
interest.

## How to brief a verifier

The verifier's job is to re-derive the result from primary sources, never to
read the implementer's report and concur.

- **Re-run the command.** Do not trust a pasted output; execute it again in
  this session.
- **Re-read the file FROM DISK**, not a cached copy carried in context from
  earlier in the conversation. A file can change between when it was last
  read and when it's being judged.
- **Re-query the live object** (the running service, the actual scheduled
  task, the actual database row) rather than a description of it.
- Never accept "the implementer said it works" as evidence. That is exactly
  the proxy signal this rule exists to route around.

## The brief must carry domain facts, not just the task

A verifier with no domain context will default to the cheapest available
signal (does it run without error, does the report sound confident) because
it has nothing sharper to check against. Handing it only the task name
produces a rubber stamp. The brief must include:

- What the relevant exit codes or status values actually mean (e.g. on
  Windows Task Scheduler, exit code `267009` is `SCHED_S_TASK_RUNNING` — the
  task is currently executing, not a failure).
- Which file or object is the authoritative source of truth, if there is more
  than one place the same fact could be read.
- What "done" concretely looks like for this task — the specific user-visible
  or system-visible state that must hold.

## Worked example: briefing a verifier

Same underlying case (the battery-skip scheduled tasks below), two different
briefs given to the verifying agent — one that would have shipped the bug,
one that caught it.

**WEAK BRIEF** (task name only, no domain facts):
> "Check the scheduled tasks were created correctly."

A verifier given only this confirms the tasks exist, are registered under the
expected names, and are scheduled to run at the expected times — then stops.
Nothing in this brief points it at any condition the tasks might fail under.
**This is the brief that would have shipped the battery bug**: the tasks
were, in fact, created correctly by every check this brief invites.

**STRONG BRIEF** (names the untested failure modes, the authoritative
properties, and the query method):
> "Two Windows scheduled tasks were just created for this job. Don't confirm
> they exist and stop there — hunt these specific untested failure modes:
> the machine running on battery power, the machine asleep at the trigger
> time, expired CLI auth at run time, the output directory having been
> deleted since the task was authored, and two rapid logons happening in one
> day. The authoritative properties to check are `DisallowStartIfOnBatteries`,
> `StartWhenAvailable`, and `ExecutionTimeLimit` — read these off the live
> task objects (e.g. `Get-ScheduledTask` / `schtasks /query`), not off the
> implementer's description of what they intended to set. Report which of
> these five conditions cause a silent skip."

Only the strong brief surfaces the actual defect: both tasks had
`DisallowStartIfOnBatteries` set, so they would skip silently — no error,
no log entry a casual check would notice — whenever the machine was
unplugged at trigger time. The weak brief's checks all passed; the bug was
never in what it looked at.

## Bias spot-checks toward the costly direction

When the verifier can't check everything, it should not sample uniformly. It
should weight its attention toward the calls whose failure loses data or
hides breakage silently — a scheduled job that skips without alerting, a
destructive migration, a config change that only breaks under a condition
(low battery, expired token) that won't show up in a quick smoke test.

## Model split

Use a cheap model for the mechanical implementation pass, and reserve the
more capable model for the verifying pass. The verifier's job — hunting for
what was never actually tested — is harder than the build, not easier; it
does not get the discount.

## Evidence: three defects self-review missed on 2026-08-03

All three of the following passed the implementer's own self-review and were
caught only because a separate agent was briefed to re-derive from primary
sources instead of reading the implementer's report:

1. **Scheduled tasks that silently skip on battery power.** A subagent
   shipped two Windows scheduled tasks. Self-review confirmed they were
   registered and would run. A reviewer briefed to hunt UNTESTED failure
   modes (sleep, battery, expired auth, deleted output dir) — not just "does
   it run" — found that both tasks were configured to skip silently when the
   machine was on battery power. The task registration looked correct; the
   condition under which it would silently do nothing was never exercised.
2. **A memory verdict judged against a cached config file.** An auditor
   marked a memory entry WRONG by comparing it to the session's in-context,
   cached copy of a config file. The file had actually changed on disk that
   same hour. A reviewer who re-read the file FROM DISK, instead of trusting
   the cached copy already in context, caught the staleness and flipped the
   verdict back to correct.
3. **An index entry that inverted the true state of shipped fixes.** A
   rebuilt index entry claimed a set of security fixes was "NONE fixed yet."
   The writer had read only the frontmatter and opening lines of an
   append-log file; the file's later sections recorded that all 7 fixes were
   completed and deployed. Reading the primary source in full — not a
   fixed-size prefix of it — was the only thing that would have caught this
   before it shipped as a false claim.

A fourth, related failure mode belongs in the same evidence set even though
it isn't a build defect: two subagents produced CORRECT artifacts but WRONG
REPORTS about them — one narrated a stale failure that its own later work had
already fixed, and one misread Windows Task Scheduler exit code `267009`
(`SCHED_S_TASK_RUNNING`) as a failure and killed its own healthy task. This is
why the verifier re-derives independently rather than reading the
implementer's narration at all: even a correct implementer can misreport its
own correct work.
