---
name: capture-lesson
version: 1.0.0
description: |
  Captures a lesson at the MOMENT it is learned, instead of waiting for the
  weekly batch sweep. Fires on exactly three triggers: a defect is found in
  something already reported done, an error is recovered from after
  non-trivial diagnosis, or the user corrects a behavior. Classifies what was
  learned as a DURABLE FACT (written to a memory file with Why /
  How-to-apply sections) or a REPEATABLE PROCEDURE (staged as a
  SKILL.md.draft, never auto-activated). A durable fact is then scoped and
  routed: PROJECT facts go to the open project's own memory dir and index,
  TOOLING facts (about gstack/a skill/the harness/the dev environment) go to
  the shared gstack lessons doc instead of one project's private memory, and
  USER/GLOBAL facts are proposed as a CLAUDE.md addition and require the
  user's go-ahead before writing. Routine successful work produces no lesson.
  Use when a bug is found after something was called done, right after
  recovering from a non-trivial error, or when the user corrects your
  behavior. (gstack)
triggers:
  - that's wrong, I told you
  - this was already broken when you said it was done
  - remember this for next time
  - don't do that again
  - capture this lesson
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# /capture-lesson -- Write the Lesson Down Before It Evaporates

You are the just-in-time counterpart to the weekly `/gstack-evolve` sweep.
`/gstack-evolve` mines many sessions for patterns that repeat 3+ times and are
only visible in aggregate. This skill catches the single sharp lesson right
now, in the session where it happened, before context is lost. The two are
not duplicates: this skill fires once, immediately, on one incident; that one
fires weekly, in batch, on diffuse patterns. Do not defer a live lesson to
"let gstack-evolve pick it up later" -- by the time it runs, the surrounding
detail is gone.

## User-invocable
When the user types `/capture-lesson`, or another skill/agent invokes this
after an incident, run this skill against the specific thing that just
happened in this session.

---

## Step A: Trigger check

Fire ONLY if the current incident is one of these three. State which one in
your output.

1. **A defect was found in something already reported done.** A fix, a
   "shipped", or a "done" claim was made earlier in this session (or a prior
   one) and has now been shown to be wrong or incomplete.
2. **An error was recovered from after non-trivial diagnosis.** More than one
   failed attempt, or root-causing that required reading source/logs/config
   rather than a one-line typo fix.
3. **The user corrected a behavior.** An explicit "no, do X instead", "don't
   do that again", "that's wrong", or similar correction of what you did or
   said.

If none of the three apply: STOP. Report `NO LESSON -- routine work` and
write nothing. A successful first-try fix, an expected/handled error, or
normal back-and-forth clarification is not a lesson.

## Step B: Classify what was learned

Classify by FORM first -- what shape is the lesson, not how widely it
applies:

- **A statement about how something IS** (a fact about this codebase, this
  environment, this user, or this tool's behavior) -> **DURABLE FACT**, even
  if the underlying mechanism is generic. Example: "Vite's dev server
  requires same-origin config or its proxy silently drops requests, and the
  proxy signals (200s, no console error) don't reveal it" is a statement of
  fact about how this project's dev server currently behaves -- write it as a
  DURABLE FACT even though Vite's CORS behavior is true on other projects
  too. What makes it a fact, not a procedure, is that there is no sequence of
  steps to follow -- just a thing to know before you next touch that code.
- **A sequence of steps that DOES something** (a repeatable recipe you'd
  follow again to accomplish a task) -> **REPEATABLE PROCEDURE**. Example: a
  3-step recipe for reproducing a flaky CI failure locally by pinning the
  shard number and seeding a fixed UUID -- that's an ordered set of actions,
  not a statement of fact.

Do NOT classify by "would this generalize to an unrelated project" -- a fact
about a widely-used tool (Vite, Postgres, Windows) is still a DURABLE FACT
here if the lesson is "here's a thing to know," not "here's what to do."
Locality is a SEPARATE question, decided in Step D below, about WHERE a
durable fact gets filed -- it never changes whether something is a fact or a
procedure.

When genuinely unsure between the two, default to DURABLE FACT -- a memory
file is cheaper to write and cheaper to be wrong about than an unreviewed
skill draft.

## Step C: Check for duplicates BEFORE writing anything

1. For a DURABLE FACT: read `MEMORY.md` in the target memory directory (path
   derivation is in Step E) and scan its RULES/LIVE/REFERENCE sections for an
   entry on the same topic (grep the topic's keywords). (TOOLING-scope facts
   get an ADDITIONAL, wider dedup pass -- see Step D's TOOLING branch, item 3
   -- because this project-local check alone is not enough for them.)
2. For a REPEATABLE PROCEDURE: list `C:\Users\Person\.claude\skills\` (top
   level, and `C:\Users\Person\.claude\skills\gstack\`) for an existing skill
   or `.draft` whose name or description already covers this procedure.
3. If a match exists: open that file and either append a dated addendum
   (`**Update <YYYY-MM-DD>:**` line under the existing `**How to apply:**` /
   procedure section) or revise the existing text. Do NOT create a second
   file and do NOT add a second `MEMORY.md` index line for the same topic.
4. Only proceed to Step D/E/F when no matching entry was found.

## Step D: Determine scope

Applies only when Step B produced DURABLE FACT. (A REPEATABLE PROCEDURE is
already scoped correctly by definition -- it drafts into
`C:\Users\Person\.claude\skills\<name>\SKILL.md.draft`, which every project
can see, not just the one currently open, so there is no scope question to
answer for it.)

Before writing anything, decide WHOSE lesson this is. One-line test: **if I
opened a different project tomorrow, would this still be true and useful?**
No -> PROJECT scope. Yes -> TOOLING or USER/GLOBAL scope (the next two
branches split that "yes").

- **PROJECT scope** -- the lesson is about the code, data, or deployment of
  the CURRENTLY OPEN project (this repo's schema, this app's routes, this
  project's CI, a bug in this project's own code). Proceed to Step E and
  write into that project's own memory directory, as below.
- **TOOLING scope** -- the lesson is about gstack itself, a specific skill,
  the agent harness, or the machine's shared dev environment -- NOT this
  project's code. Do not write into any project's private memory: no other
  project would ever read it there, and filing it there does not lead to the
  actual bug getting fixed. Instead:
  1. Write to `C:\Users\Person\.claude\skills\gstack\docs\lessons\<slug>.md`
     (create `docs\lessons\` if it doesn't exist yet). Body still carries
     `**Why:**` / `**How to apply:**`, same shape as a project memory file,
     just without the `metadata.type` scheme (that scheme is for
     project-memory files only -- see Step E item 2's tiebreaker).
  2. In the Output step (below), state explicitly whether this is fixable:
     if the lesson names a defect in a specific, identifiable skill or file,
     say so as "this is fixable: `<skill path>` does X, should do Y" -- so
     the user can act on it, not just archive a note.
  3. De-dup for TOOLING scope is WIDER than Step C's default check: also grep
     the gstack skills tree itself (every `SKILL.md` and `SKILL.md.tmpl`
     under `C:\Users\Person\.claude\skills\gstack\`, plus
     `docs\lessons\*.md`) before writing -- the lesson may already be
     documented inline in the very skill it concerns (verified case: a
     Windows `browse` vs `browse.exe` extension defect is already called out
     in `verify-outcome/SKILL.md`'s own body text -- writing a new lessons
     file for that would just be a redundant note). If it's already
     documented there, do not write a new lessons file -- report where it
     already lives instead.
- **USER/GLOBAL scope** -- a durable preference or fact about the user (not
  the tooling, not one project) that applies everywhere they work. Do NOT
  write `C:\Users\Person\.claude\CLAUDE.md` directly -- propose the exact
  text and which section it belongs under, and ASK the user before writing
  it, since that file is the user's own per their autonomy rules.

## Step E: Write a DURABLE FACT (PROJECT scope)

1. **Locate the memory directory.** The directory name is the absolute
   working directory with every character that is not a letter or digit
   replaced by `-` (repeated dashes are NOT collapsed). Example: cwd
   `C:\Users\Person\Downloads\TaskMaster (4)\Lezam1` sanitizes to
   `C--Users-Person-Downloads-TaskMaster--4--Lezam1`. Full path:
   `C:\Users\Person\.claude\projects\<sanitized-cwd>\memory\`.
   Do not trust your own derivation blindly -- list
   `C:\Users\Person\.claude\projects\` and confirm a directory matching that
   name already exists (Claude Code creates it at session start for the
   active project). If your derived name doesn't exactly match an existing
   entry, match by longest common prefix against the listing instead of
   guessing further. Create `memory\` under it if the subfolder itself is
   missing.
2. **Pick `<type>`** (one of exactly these four, used as both the metadata
   value and the filename prefix). `reference` and `user` both describe
   facts rather than status, so use this tiebreaker between them: `reference`
   = how something in THIS PROJECT works; `user` = a fact about the person or
   their machine that is project-independent. If the fact is actually about
   tooling (gstack, a skill, the harness, or the shared dev environment)
   rather than this project or the user, it is TOOLING scope (Step D) and
   does NOT use either `reference` or `user` -- don't force a tooling fact
   into this list.
   - `feedback` -- a correction of Claude's own behavior or output.
   - `reference` -- a how-to or technical fact about how something in THIS
     PROJECT works.
   - `project` -- status/context about a specific ongoing piece of work.
   - `user` -- a fact about the person or their machine, project-independent
     (but not durable/global enough, or not yet confirmed with the user, to
     warrant the USER/GLOBAL-scope `CLAUDE.md` proposal in Step D).
3. **Slug**: lowercase, 2-5 words. Write it once, in underscore form (e.g.
   `no_repetition`, `windows_browser_automation`); the hyphen form used below
   is the same slug with `_` swapped for `-`, nothing more.
4. **Filename**: `<type>_<slug>.md` (underscore-joined slug), e.g.
   `feedback_no_repetition.md`.
5. **Frontmatter** (this is the convention this project's existing memory
   files already use, e.g. `feedback_no_repetition.md` and
   `reference_windows_browser_automation.md` -- match it, don't invent a
   variant):
   ```yaml
   ---
   name: <type>-<slug> (hyphen-joined)
   description: "<one sentence, specific enough to search on>"
   metadata:
     node_type: memory
     type: <type>
     originSessionId: <current session ID if you know it, else omit this line>
   ---
   ```
6. **Body**: 1-3 sentence statement of the fact, then:
   - `**Why:**` -- the evidence or incident that established it.
   - `**How to apply:**` -- imperative bullets: what to do differently next
     time.
7. **Append exactly ONE line** to `MEMORY.md` in the same memory directory,
   under the section that matches `<type>`, by this fixed mapping (read this
   project's own `MEMORY.md` to see it in effect: every `feedback_*` file is
   indexed under `## RULES`, every `reference_*` file under `## REFERENCE`,
   every `project_*` file under `## LIVE`):
   - `type: feedback` -> `## RULES`
   - `type: reference` -> `## REFERENCE`
   - `type: project` -> `## LIVE`
   - `type: user` -> `## RULES` (no `user_*` precedent exists yet in this
     project; RULES is the closest fit since user-level facts function as
     standing rules)
   - Exception: if the fact describes an open/unresolved state rather than a
     settled rule or reference (compare to how
     `reference_route_test_login_broken.md` is indexed under `## LIVE` even
     though its filename says `reference`), index it under `## LIVE` instead,
     regardless of `<type>`.
   Line form, exactly:
   `- [Title](<filename>.md) — <one-line hook, under ~120 chars>`
   If none of `## RULES` / `## LIVE` / `## REFERENCE` exist yet in this
   `MEMORY.md`, create the target section header at the end of the file, then
   add the line under it. Touch only that one new line plus, if just created,
   its header -- do not reformat or reorder any other existing line.

## Step F: Write a REPEATABLE PROCEDURE

1. **Name it**: verb-noun, kebab-case (e.g. `deploy-webhook`).
2. **Check for collisions**: list `C:\Users\Person\.claude\skills\` and
   `C:\Users\Person\.claude\skills\gstack\`; if the name is taken, append a
   number (`deploy-webhook-2`).
3. **Write ONLY to**
   `C:\Users\Person\.claude\skills\<name>\SKILL.md.draft` (create the
   directory if needed). NEVER write an active `SKILL.md` directly, and never
   stage a draft under the `gstack\` repo path -- drafts are always staged at
   the top level, matching the existing `/gstack-evolve` draft convention.
4. **Structure**, matching `/gstack-evolve`'s drafting rules: YAML
   frontmatter (`name`, one-paragraph `description` including the trigger
   phrases actually used in this incident), then body sections
   `## Configuration`, `## Step-by-step`, `## Safety rules`, abstracting the
   procedure just executed into reusable steps.
5. **Safety scan**: if the procedure's steps include `rm -rf`, a force-push
   to main/master, `DROP TABLE`, `chmod -R 777`, or another irreversible
   data-loss pattern, prepend `**SAFETY REVIEW REQUIRED**` as the first line
   of the draft body.
6. **Never auto-activate.** Do not rename `.draft` away, and do not tell the
   user it is active -- tell them the draft path and that it needs their
   explicit review (same rule as `/gstack-evolve` Step 9).

---

## Step G: Output

Report exactly one of `DURABLE FACT` / `REPEATABLE PROCEDURE` / `NO LESSON`,
which of the three Step A triggers fired (or "none" for NO LESSON), the scope
(`PROJECT` / `TOOLING` / `USER-GLOBAL`) when the verdict was DURABLE FACT, the
file path written or updated (or, for USER/GLOBAL, the proposed `CLAUDE.md`
text awaiting the user's yes/no), and for a procedure, an explicit reminder
that it is an inactive `.draft` awaiting review. For TOOLING scope, always
include the fixable-or-not line from Step D's TOOLING branch item 2.
