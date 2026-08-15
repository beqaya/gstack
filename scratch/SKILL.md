---
name: scratch
version: 0.1.0
description: Answers a side question mid-task using the full conversation context, while making "no writes happen" structurally true instead of a promise. (gstack)
triggers:
  - scratch mode
  - quick question
  - side question
  - just curious, don't change anything
  - answer only, no writes
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->


## When to invoke this skill

Arms a sentinel (~/.gstack/.scratch-mode) that the gstack-generated-guard
PreToolUse hook checks before every Edit and Write and denies
unconditionally while it is fresh — the sentinel self-expires 30 minutes
after it is created, so a session that dies mid-scratch can never wedge
editing on this machine permanently. Answers using Read, Grep, Glob, and
non-mutating Bash only, then deletes the sentinel on every exit path,
success or failure, before returning control. Use when the user asks a
side question while a pipeline or long task is running — "what is this
mode?", "what does rotating a key mean?", "quick question", "just
curious" — and the answer should not be able to cause a stray write.

# /scratch — Answer a Side Question, Structurally Read-Only

```bash
mkdir -p ~/.gstack/analytics
echo '{"skill":"scratch","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
```

## What this is for

Mid-task, the user often asks a side question that has nothing to do with
the pipeline running — "what does this flag do?", "what does rotating a key
mean?", "quick question, is X the same as Y?". Answering that inline, on the
main thread, means the answer-generation turn shares every tool the main
task has — including Edit and Write. Nothing stops a side answer from
becoming a stray edit.

`/scratch` makes "this turn cannot write" a property of the *system*, not a
promise the model makes to itself. It does this by arming a sentinel file
that a PreToolUse hook (`gstack-generated-guard`, already wired on
Edit/Write in `~/.claude/settings.json` — this skill adds no new hook)
checks before any Edit or Write and unconditionally denies while the
sentinel is fresh.

## Honest scope — read this before trusting the boundary

**Structural enforcement covers Edit and Write only.** The guard hook fires
on those two tools. It does **not** intercept Bash. Bash can still run `rm`,
`git commit`, `curl -X POST`, overwrite a file with `>`, or anything else
that mutates state. Scratch mode does **not** make Bash safe by
construction — it is a **discipline** for Bash (Step 2 below tells you which
Bash calls are in-bounds), not a technical guarantee. Do not tell the user
"nothing can be written" without this caveat. Overstating the guarantee is
worse than the honest, narrower one: a past incident in this repo shipped a
false enforcement claim, and it cost more trust than the gap itself would
have.

Read-only in this skill means: `Read`, `Grep`, `Glob`, and Bash calls that
only *observe* — `git status`, `git log`, `git diff`, `git show`, `cat`,
`ls`/`find`, read-only `curl`/API `GET` calls, `type`/`Get-Content`. Never
run `Edit`, `Write`, or a mutating Bash command while scratch mode is armed.

## Step 1 — Arm the sentinel

```bash
mkdir -p ~/.gstack
date -u +%Y-%m-%dT%H:%M:%SZ > ~/.gstack/.scratch-mode
```

This writes the current UTC time as the sentinel's content (for a human
reading the file to see when it was armed). The guard's actual freshness
check uses the file's mtime, not its content — matching the pattern already
used by this repo's other sentinel (`~/.gstack/.allow-generated-edit`), and
avoiding any dependency on parsing the timestamp string correctly.

From this point until Step 3 or Step 4 runs, every Edit and Write anywhere
on this machine is denied by the guard — not just edits related to this
question.

## Step 2 — Answer the question

Answer using the full conversation context you already have (this is a
side question inside an ongoing task, not a fresh investigation) plus
`Read`, `Grep`, `Glob`, and observe-only `Bash` as needed. Do not run `Edit`
or `Write` — the guard backstops this, but do not rely on being caught;
treat the tool restriction as real, not just enforced.

## Step 3 — Disarm the sentinel (success path)

Before returning the answer to the user, delete the sentinel:

```bash
rm -f ~/.gstack/.scratch-mode
```

Then give the answer. Do not report the answer before this runs — the
sentinel must be gone by the time control returns to the main thread, or
the next Edit/Write in the real task gets denied for no reason the user
can see.

## Step 4 — Disarm the sentinel (error path)

If the question cannot be answered — missing information, a tool failure,
an ambiguous ask you need to bounce back to the user — **still delete the
sentinel before returning**:

```bash
rm -f ~/.gstack/.scratch-mode
```

Treat Step 3/Step 4 as a `finally` block relative to Step 2, not an
if-branch: no exit from this skill, successful or not, skips the delete.
This is what makes the 30-minute expiry a backstop and not the primary
cleanup path — the primary path is this explicit delete on every exit.

## How the guard enforces this

`~/.claude/skills/gstack/bin/gstack-generated-guard` checks the scratch
sentinel **first**, before its existing generated-file logic (adapter-tree /
`.tmpl`-sibling / `AUTO-GENERATED` marker detection — untouched by this
skill):

- **No sentinel** → falls through to the pre-existing generated-file checks,
  unaffected.
- **Sentinel present, under 30 minutes old** → denies the Edit/Write with
  this message (verbatim):

  > `[gstack-generated-guard] Blocked: scratch mode is active — /scratch
  > promises a read-only side answer, so no Edit or Write is permitted until
  > it finishes. This block is structural, not a request: it applies to
  > every file, not just generated ones. If scratch mode is stuck (its
  > session ended before it could clean up), clear it yourself:
  > `Remove-Item -Force "$env:USERPROFILE\.gstack\.scratch-mode"` — or just
  > wait, it self-expires 30 minutes after it started.`

- **Sentinel present, 30+ minutes old** → treated as abandoned (the session
  that armed it likely died before Step 3/4 ran). The guard deletes it and
  allows the edit to proceed through the normal (non-scratch) checks. This
  is the failure mode this design exists to prevent: a dead scratch session
  must never wedge editing on this machine forever.

The denial message always repeats the exact clear command so a stuck user
always has a way out without waiting the full 30 minutes:

```powershell
Remove-Item -Force "$env:USERPROFILE\.gstack\.scratch-mode"
```

## Worked example

User, mid-`/qa` run: "quick question — what does 'idempotent-skip' mean in
that commit message?"

1. Arm: `mkdir -p ~/.gstack && date -u +%Y-%m-%dT%H:%M:%SZ > ~/.gstack/.scratch-mode`
2. Answer from context + a `Grep` for `idempotent-skip` in the repo to
   ground the explanation in the actual code, not a generic definition. No
   Edit, no Write.
3. Disarm: `rm -f ~/.gstack/.scratch-mode`
4. Reply: "It means the remediation step recognizes work it already did (via
   the drizzle upsert's `onConflictDoNothing` path) and skips re-applying it
   instead of erroring — see `server/remediation/apply.ts:112`."

The `/qa` run that was in flight before the question is untouched; scratch
mode never touched any file, and the sentinel is gone by the time the next
real Edit in that run fires.

## Notes

- Scratch mode is global per machine, not per-session — while armed, it
  blocks Edit/Write for every session on this machine, not just the one
  that asked the question. This is intentional: the sentinel lives outside
  any single session's control, the same design already used by
  `~/.gstack/.allow-generated-edit`.
- Do not use `/scratch` for anything that needs to end in a file change.
  If the "side question" turns out to need a fix, disarm (Step 3/4), answer
  that it needs a real edit, and let the user route it to the main task or
  a dedicated skill.
- If you find `~/.gstack/.scratch-mode` present at the *start* of an
  unrelated task and don't know why, don't assume it's safe to leave: check
  its age (`Get-Item ~/.gstack/.scratch-mode | Select LastWriteTime` /
  `stat ~/.gstack/.scratch-mode`). If it is stale, clear it with the command
  above rather than waiting on the guard's own expiry check to fire on the
  next edit attempt.
