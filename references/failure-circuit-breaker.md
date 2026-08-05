# Failure Circuit Breaker — Tier 1 Guard

## Status: guidance, not enforced

Nothing stops an agent from retrying after `gstack-failure-count` prints
`BREAK`. This is not a `PreToolUse` hook. It exists so an agent — or a human
reading the transcript — has an unambiguous, externally-computed stop signal
instead of having to trust the agent's own in-the-moment judgment about
whether "just one more try" is reasonable. That judgment is exactly what
fails under repeated failure, which is the whole reason this guard exists.

## The rule

Before retrying a failing action, record the outcome with
`gstack-failure-count <task-id> --record same|different|infra` and read what
it prints. On `BREAK`, stop retrying and produce the SUMMARY FORMAT below
instead of another attempt.

The bin directory is not on PATH, so invoke it through `python` with the full
path (tested from both PowerShell and Git Bash — a bare `gstack-failure-count`
will not resolve):

```
python "C:\Users\Person\.claude\skills\gstack\bin\gstack-failure-count" <task-id> --record same        # identical action failed again
python "C:\Users\Person\.claude\skills\gstack\bin\gstack-failure-count" <task-id> --record different    # a different action failed
python "C:\Users\Person\.claude\skills\gstack\bin\gstack-failure-count" <task-id> --record infra         # ENOTFOUND / ConnectionRefused / ETIMEDOUT / HTTP 5xx
python "C:\Users\Person\.claude\skills\gstack\bin\gstack-failure-count" <task-id> --status               # inspect current counts, no side effect
python "C:\Users\Person\.claude\skills\gstack\bin\gstack-failure-count" <task-id> --reset                # clear state for a new task
```

State lives at `~/.gstack/failures/<task-id>.json`: `consecutive_same`,
`total`, `infra_count`.

## Thresholds

`BREAK` fires when, after the current record is applied:

- `consecutive_same >= 3` — the same action was retried and failed three
  times in a row, or
- `total >= 10` — ten failures have accumulated in this task, same action or
  not.

**Infra grace period.** The first two `infra` records in a task are free:
they increment `infra_count` but never touch `consecutive_same` or `total`,
and always print `CONTINUE`. This exists because retrying a genuine network
blip is the *correct* response, not runaway behavior — three agents
independently died to real `ENOTFOUND`/`ConnectionRefused` errors in one
evening, and killing the retry loop on the first hit of any of those would
have broken correct behavior along with the runaway case. From the third
`infra` record on, it counts exactly like `same` (increments both
`consecutive_same` and `total`) — by the third repeat of the identical infra
error in one task, it has stopped looking like a blip and started looking
like the same failure mode `same` exists to catch.

## The worked example this guard was built for

An agent scheduled a Windows task and later needed to check whether it had
finished. It read exit code `267009` back from the scheduler and treated it
as a failure. `267009` is `SCHED_S_TASK_RUNNING` — the task was not failing,
it was **still running**. Believing it had found a bug, the agent killed its
own healthy task, then reported the kill itself as evidence that something
was broken. Nothing in the loop was counting attempts or asking "have I seen
this exact outcome before, and what does that repetition imply about my own
diagnosis rather than about the target?" — so there was no forcing function
to stop and reconsider before acting on a misread. Had the agent recorded
each "it's still running, that must mean it failed" check as a `same`
failure, the third recorded incorrect assumption would have printed `BREAK`
before the kill, forcing a summary instead of the action.

## SUMMARY FORMAT (produce this when the breaker trips)

Do not retry again. Do not summarize in prose. Produce exactly these four
sections:

1. **What was attempted** — the concrete action, verbatim (the command run,
   the API call made, the file checked), not a paraphrase of intent.
2. **What each attempt returned** — one line per attempt: the literal
   output, exit code, or error. Not "it failed again" — the actual text.
3. **What they have in common** — the shared feature across attempts (same
   exit code, same error string, same tool, same misread assumption).
4. **Two likeliest explanations** — the two most probable root causes for
   that common feature, stated as testable claims, not as "not sure why."

Applied to the `267009` incident, this would have produced:

1. **What was attempted:** queried the scheduled task's status via
   `schtasks /query`, read exit code `267009`, and (on the third recorded
   occurrence) killed the task expecting to then relaunch it clean.
2. **What each attempt returned:** all three queries returned `267009`
   with no other change in observed state — the task's log kept growing
   between queries.
3. **What they have in common:** the same exit code, interpreted the same
   way each time, driving the same corrective action (treat-as-failure)
   without ever checking what `267009` actually decodes to.
4. **Two likeliest explanations:** (a) the exit code is being misread — it
   maps to `SCHED_S_TASK_RUNNING`, not a failure; (b) the task is genuinely
   hung and `267009` is technically accurate but the task never progresses —
   distinguishable by checking whether the task's own log output is still
   advancing between polls (it was, which rules out (b)).

## The three anti-rationalizations

These are the specific phrases an agent tells itself to justify a fourth
attempt after `BREAK`. Each one is a rationalization, not a reason, and each
has a direct counter.

**"this attempt is different"**
Counter: if it were actually different, it would have been recorded as
`--record different`, which resets the same-action streak instead of adding
to it. If you're reading `BREAK` off a `consecutive_same >= 3` streak, the
counter already agrees it's the same action — arguing it's "different" now,
after the fact, is re-litigating a classification you already made
truthfully when you recorded it. Go back and check what you actually typed
into `--record`; don't relabel it in your head after the threshold trips.

**"one more will do it"**
Counter: this was true, statistically, on attempt one. By attempt three of
the identical action, the evidence is that whatever is broken is not
resolved by repetition — repetition is not a mechanism, it's the absence of
one. "One more" is only a reason to act if something about the world changed
between attempts (a fix landed, a service recovered, a lock released). If
nothing changed, the fourth attempt has the same expected outcome as the
third: name what specifically changed, or stop.

**"the failure is transient"**
Counter: this is exactly what the `infra` grace period exists to test
honestly, not to invoke as an excuse. If it's genuinely transient, classify
it `infra` and it gets two free retries with no penalty — that's the
mechanism built for this claim. If you've already burned the grace period
(this is the third-or-later `infra` record, or you're recording `same`
because it's the identical action failing the identical way), then
"transient" has already been tested against reality twice and reality said
no. Claiming transience a third time isn't invoking the exception, it's
ignoring that the exception already ran out.
