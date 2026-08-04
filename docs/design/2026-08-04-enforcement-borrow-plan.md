# gstack Enforcement Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give gstack the four enforcement mechanisms it lacks — an outcome-evidence gate, an independent-verifier rule, just-in-time lesson capture, and a locked state spine — borrowed from GSD, superpowers, and Hermes.

**Architecture:** Three new gstack skills (`verify-outcome`, `capture-lesson`, `session-lock`), one new shared reference doc, two edits to existing ship-path skills, and one rule in the user's global CLAUDE.md — plus (scope widened 2026-08-04 by founder decision) GSD's thin-orchestrator pattern as a documented, opt-in role rather than a rewrite: a reference doc plus a `delegate` skill that dispatches waves of subagents and is forbidden from editing source files itself. No existing skill's behaviour changes beyond the two ship-path gate insertions.

**Tech Stack:** Markdown SKILL.md files with YAML frontmatter (gstack's `description: |` rich form, since all 53 skills now use it), bash/PowerShell snippets inside skills, Python 3.13 at `C:/Program Files/Python313/python.exe` for verification scripts.

## Global Constraints

- gstack repo: `C:\Users\Person\.claude\skills\gstack` — currently on branch `custom/frontmatter-routing`, one commit ahead of upstream. Commit there; push to the `fork` remote only.
- **The live skills are COPIES, not junctions.** Every new or edited `SKILL.md` under the repo MUST also be copied to the matching top-level `C:\Users\Person\.claude\skills\<name>\SKILL.md`, or the change has no effect.
- New skills use the rich `description: |` frontmatter form matching commit `731d97ec`, ending with the ` (gstack)` marker.
- One git verb per command invocation.
- **This is a general gstack enhancement, not project work.** Everything lands in
  the gstack repo. No consuming project's repository may be modified by this
  plan — the state-spine mechanism (Task 5) ships as a gstack convention that any
  project can adopt, never as an edit to one project's files.
- Never auto-activate a skill draft; drafts require review.
- Full Windows paths in all user-facing output.
- The 2026-08-03 blank-page outage is used throughout as an ACCEPTANCE FIXTURE
  because it is a concrete case where every proxy signal was green while the
  product was broken. It is evidence for the design, not project scope.

---

### Task 1: `verify-outcome` skill

**Files:**
- Create: `C:\Users\Person\.claude\skills\gstack\verify-outcome\SKILL.md`
- Copy to: `C:\Users\Person\.claude\skills\verify-outcome\SKILL.md`

**Interfaces:**
- Produces: the `/verify-outcome` skill that Task 4 wires into `ship` and `land-and-deploy`. Verdict vocabulary — `PROVEN` / `UNPROVEN` / `CONTRADICTED` — is referenced by Task 4 and Task 6; use these exact strings.

- [ ] **Step 1: Write the skill file.** Frontmatter `name: verify-outcome`, rich `description: |` covering: proves a claim of the form "X now works" with evidence a USER would recognise; rejects proxy signals; use when asked to "verify it works", "prove it", "confirm the fix", or before reporting anything shipped. End the description with ` (gstack)`.

  Body must contain, verbatim as rules:
  - **Step A — name the outcome.** State the user-visible thing that must be true, in one sentence, in user language ("the landing page renders its headings"), never in implementation language ("the bundle returns 200").
  - **Step B — pick the evidence class** by what kind of thing it is:
    - web UI → drive a real browser and assert on RENDERED DOM content (element count and text), following the browser fallback chain in the user's CLAUDE.md; a status code is not evidence
    - HTTP API → issue a real request and assert on the response BODY
    - CLI → run the command and assert on its output
    - background job / data → assert the row, file, or artifact it was supposed to produce exists and has the expected shape
  - **Step C — record the verdict**: `PROVEN` (evidence shown inline), `UNPROVEN` (say exactly which evidence was missing), `CONTRADICTED` (evidence shows it does NOT work).
  - **NEVER-SUFFICIENT list** (these alone can never yield PROVEN): HTTP 2xx, "tests pass", "CI green", "deploy succeeded", "no errors in the logs", an implementer subagent reporting success, or the absence of a complaint.
  - **Default is UNPROVEN.** Missing evidence never passes.
  - A worked example citing the 2026-08-03 outage: health 200 + green CI + two successful deploys, while the real browser showed `#root` with zero children — the correct verdict there was `CONTRADICTED`.

- [ ] **Step 2: Validate frontmatter.** Run: `"C:/Program Files/Python313/python.exe" -c "import re,sys;t=open(r'C:\Users\Person\.claude\skills\gstack\verify-outcome\SKILL.md',encoding='utf-8').read();m=re.match(r'^---\n(.*?)\n---\n',t,re.S);print('OK' if m and 'name: verify-outcome' in m.group(1) and 'description: |' in m.group(1) else 'BAD')"` — Expected: `OK`

- [ ] **Step 3: Sync to the live top-level copy.** Create the directory if needed, then copy the file. Verify with a diff that the two files are identical.

### Task 2: `capture-lesson` skill

**Files:**
- Create: `C:\Users\Person\.claude\skills\gstack\capture-lesson\SKILL.md`
- Copy to: `C:\Users\Person\.claude\skills\capture-lesson\SKILL.md`

**Interfaces:**
- Consumes: nothing from Task 1. Produces: the just-in-time counterpart to the weekly `/gstack-evolve`; Task 6 verifies it classifies correctly.

- [ ] **Step 1: Write the skill file.** Frontmatter `name: capture-lesson`, rich `description: |`: captures a lesson at the MOMENT it is learned rather than in the weekly batch; use when a defect is found after something was called done, an error is recovered from after non-trivial diagnosis, or the user corrects a behaviour. End with ` (gstack)`.

  Body rules:
  - **Trigger check** — only fire on one of the three triggers above. Routine successful work produces no lesson.
  - **Classify what was learned** using Hermes' split:
    - DURABLE FACT about this project/user/environment → write a memory file under the project's memory directory, with `**Why:**` and `**How to apply:**` sections, and add ONE index line to `MEMORY.md`.
    - REPEATABLE PROCEDURE → write a `SKILL.md.draft` (never an active `SKILL.md`), following the existing gstack-evolve draft convention.
  - **Never auto-activate a draft.** Activation requires user review.
  - **Do not duplicate**: check the memory index and existing skills first; update the existing entry instead of adding a near-duplicate.
  - **Relationship to `/gstack-evolve`**: this skill catches the single sharp lesson in the moment; `/gstack-evolve` still runs weekly for diffuse patterns visible only across many sessions. State this explicitly so the two are not confused.

- [ ] **Step 2: Validate frontmatter** with the same one-liner as Task 1 Step 2, substituting the path and name — Expected: `OK`

- [ ] **Step 3: Sync to the live top-level copy** and diff-verify identical.

### Task 3: Independent-verification reference

**Files:**
- Create: `C:\Users\Person\.claude\skills\gstack\references\independent-verification.md`
- Modify: `C:\Users\Person\.claude\CLAUDE.md` (add the rule under "How to work")

**Interfaces:**
- Produces: the doc that Task 4's edits point at. Anchor text used by later tasks: "independent verification".

- [ ] **Step 1: Write the reference doc.** Contents:
  - The rule: any agent that FIXES or BUILDS something must have a DIFFERENT agent verify the result. Self-review never substitutes.
  - How to brief a verifier: instruct it to re-derive from primary sources — re-run the command, re-read the file FROM DISK (not a cached copy), re-query the live object — never to read the implementer's report and concur.
  - Brief must carry DOMAIN FACTS, not just the task: what the relevant exit codes mean, which file is authoritative, what "done" looks like.
  - Bias spot-checks toward the costly direction (verify the calls whose failure loses data or hides breakage).
  - Model split: cheap model for mechanical implementation, capable model for the verifying pass that hunts what was never tested.
  - Evidence section: three defects caught on 2026-08-03 by exactly this separation — scheduled tasks that would silently skip on battery power, a memory verdict judged against a cached config file, an index entry claiming shipped fixes were unfinished. All three passed self-review.

- [ ] **Step 2: Add the rule to the user's global CLAUDE.md** under the "How to work" section, as one bullet: any fix or build I make gets verified by a different agent re-deriving from primary sources, briefed with the domain facts, never by reading the implementer's own report. Reference the doc path.

- [ ] **Step 3: Verify** the CLAUDE.md edit did not disturb neighbouring bullets (read the section back and confirm the surrounding lines are unchanged).

### Task 4: Wire the gate into the ship path

**Files:**
- Modify: `C:\Users\Person\.claude\skills\gstack\ship\SKILL.md`
- Modify: `C:\Users\Person\.claude\skills\gstack\land-and-deploy\SKILL.md`
- Copy both to their top-level equivalents.

**Interfaces:**
- Consumes: `verify-outcome` (Task 1) and the verdict strings `PROVEN` / `UNPROVEN` / `CONTRADICTED`.

- [ ] **Step 1: Read each skill's final/reporting section** and identify the exact step where it declares success. Do not restructure the skill; only add a gate immediately before that declaration.

- [ ] **Step 2: Insert the gate in `ship`.** Text to add:
  > **Outcome gate (mandatory).** Before reporting this shipped, invoke `/verify-outcome` for the user-visible thing this change was supposed to make true. A `PROVEN` verdict is required to report success. On `UNPROVEN` or `CONTRADICTED`, report exactly that instead — including what evidence was missing — and do NOT describe the work as shipped. A green CI run, a successful deploy, and an HTTP 200 are explicitly not substitutes (see the 2026-08-03 blank-page outage, where all three were green while the site rendered nothing).

- [ ] **Step 3: Insert the same gate in `land-and-deploy`**, worded for its post-deploy verification step rather than PR creation.

- [ ] **Step 4: Sync both files to their top-level copies** and diff-verify each.

- [ ] **Step 5: Commit Tasks 1-4 in the gstack repo** (one git verb per call): `git add` the four SKILL.md files and the reference doc, then commit with message `feat(skills): outcome-evidence gate, JIT lesson capture, independent-verification rule`, then `git push fork custom/frontmatter-routing`.

### Task 5: Locked state spine (shipped as a gstack skill, not a project edit)

**Files:**
- Create: `C:\Users\Person\.claude\skills\gstack\session-lock\SKILL.md`
- Copy to: `C:\Users\Person\.claude\skills\session-lock\SKILL.md`

**Interfaces:**
- Independent of Tasks 1-4. Produces `/session-lock`, which any project can adopt
  without gstack knowing anything about that project.

- [ ] **Step 1: Write the skill.** Frontmatter `name: session-lock`, rich
  `description: |`: coordinates multiple concurrent agent sessions writing the
  same shared status/tracker file; use when asked to "claim the board", "take the
  lock", "who owns this", or when several sessions work one repo. End with ` (gstack)`.

  The skill must be PROJECT-AGNOSTIC: it takes the tracker path as an argument
  and defaults to `docs/STATUS.md` only if that file already exists. It never
  assumes a particular project's layout, sections, or row format.

  Protocol the skill implements:
  - Lock file lives beside the tracker as `<tracker-dir>/.<tracker-name>.lock`
    and contains `<session-id> <ISO-8601 timestamp>`.
  - Acquire before writing; release (delete) immediately after.
  - A lock under 30 minutes old is HELD: do not write. Report which session holds
    it and for how long, then coordinate rather than clobbering.
  - A lock 30 minutes or older is STALE and MAY be broken; the breaking session
    records that it broke a stale lock and whose it was.
  - The lock is ADVISORY: it must NEVER block an emergency fix. Breaking it
    knowingly is legal; ignoring it silently is not.
  - Instruct the user to gitignore the lock pattern in whatever repo adopts it —
    the skill must NOT edit any project's `.gitignore` itself.

- [ ] **Step 2: Validate frontmatter** with the same one-liner as Task 1 Step 2,
  substituting path and name — Expected: `OK`

- [ ] **Step 3: Sync to the live top-level copy** and diff-verify identical.

- [ ] **Step 4: Commit in the gstack repo** with Tasks 1-4's commit, or separately
  as `feat(skills): session-lock for multi-session tracker coordination`. Push to
  the `fork` remote. No project repository is touched by this task.

### Task 6: Thin orchestrator (GSD) — documented role + `delegate` skill

Scope widened 2026-08-04 by founder decision. Shipped as an OPT-IN pattern, not
a rewrite: no existing skill is restructured, and nothing forces a caller to use
it. The value is that the coordinating agent becomes structurally incapable of
also doing and grading the work.

**Files:**
- Create: `C:\Users\Person\.claude\skills\gstack\references\thin-orchestrator.md`
- Create: `C:\Users\Person\.claude\skills\gstack\delegate\SKILL.md`
- Copy the skill to: `C:\Users\Person\.claude\skills\delegate\SKILL.md`

**Interfaces:**
- Consumes: the independent-verification reference (Task 3) — the orchestrator's
  verify step cites it rather than restating the rule.
- Produces: `/delegate`, referenced by Task 7's validation.

- [ ] **Step 1: Write `references/thin-orchestrator.md`.** Content:
  - THE RULE: when acting as orchestrator, the controller does NOT edit source
    files. It decomposes, dispatches subagents, reads their reports, and updates
    state. Editing is delegated even when the edit looks trivial — "it's one
    line" is the rationalization that collapses the separation.
  - WHY: two independent benefits. (a) The controller's context stays clean, so
    long sessions do not degrade — subagent tool output never lands in it.
    (b) The agent coordinating work cannot also be the agent grading it, which
    is the same separation Task 3 requires for verification.
  - WAVES: group dispatched work by dependency. Tasks with no shared files and
    no ordering constraint form one wave and run concurrently; a task that
    consumes another's output belongs to a later wave. Run shared pre-commit or
    lint hooks ONCE PER WAVE, not once per agent, to avoid lockfile contention.
  - FILE-SCOPE RULE: two agents in the same wave must never be able to write the
    same file. If they could, they belong in different waves.
  - WHEN NOT TO USE IT: single-file edits, conversational answers, and anything
    where dispatch overhead exceeds the work. State this explicitly so the
    pattern is not applied dogmatically.

- [ ] **Step 2: Write `delegate/SKILL.md`.** Frontmatter `name: delegate`, rich
  `description: |`: run a multi-step job as an orchestrator that never edits
  files itself — decompose into waves, dispatch a subagent per unit, verify each
  with a different agent, and report; use when asked to "delegate this", "run
  this as an orchestrator", "fan this out", or for any job of 3+ independent
  units. End with ` (gstack)`.

  Body must specify:
  1. DECOMPOSE — list the units of work and, for each, the files it will touch.
  2. WAVE — group units so that no two in a wave share a file. State the waves
     and their contents before dispatching anything.
  3. DISPATCH — one subagent per unit, briefed with its task, the domain facts
     it needs, and its file scope. Cheap model for mechanical units.
  4. VERIFY — a DIFFERENT agent checks each completed unit per
     `references/independent-verification.md`. Capable model for this pass.
  5. STATE — after each wave, record progress where the caller specified (or via
     `/session-lock` if a shared tracker is in play).
  6. REPORT — what shipped, what failed, what is unverified. Never claim success
     for a unit whose verification did not pass.
  - HARD CONSTRAINT, stated in the skill: while acting under `/delegate`, the
    orchestrator makes NO file edits of its own. If it finds itself about to
    edit, that is a missed unit — dispatch it instead.

- [ ] **Step 3: Validate frontmatter** with the Task 1 Step 2 one-liner,
  substituting path and name — Expected: `OK`

- [ ] **Step 4: Sync `delegate` to its top-level copy** and diff-verify identical.

- [ ] **Step 5: Commit and push** to the `fork` remote:
  `feat(skills): thin-orchestrator pattern + /delegate`

### Task 7: Validate all five mechanisms

**Files:** none created; this task only runs checks and reports.

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Fixture-test `verify-outcome` against the real outage.** The pre-fix state is reproducible from evidence already captured: `/api/health` 200, CI green, both deploys succeeded, and the browser showed `#root` with zero children and a 500 on the JS bundle. Confirm the skill's rules yield `CONTRADICTED` for that input and `PROVEN` for the current state (verified 2026-08-04: assets 200, `#root` has 2 children, 2,521 characters of text including the heading "Transform Your Cybersecurity Compliance"). Record both determinations.

- [ ] **Step 2: Fresh-context check of the verification rule.** Dispatch a subagent with NO session context, asking only: "You are working on this machine. How should you verify a fix you just made?" PASS if it describes re-deriving from primary sources and using a different agent; FAIL if it describes re-reading its own report or trusting tests alone. If FAIL, the rule text in Task 3 is too weak — strengthen and re-run.

- [ ] **Step 3: Lock concurrency check.** Simulate two writers: create `docs/.STATUS.lock` with a fresh timestamp, confirm the documented protocol says the second writer must not write; then backdate the lock past 30 minutes and confirm the protocol permits breaking it with a recorded note. Delete the test lock afterwards.

- [ ] **Step 4: `capture-lesson` classification check.** Feed it the CORS incident. Expected: it produces a DURABLE FACT (memory file about the Vite `crossorigin` / same-origin CORS trap and that proxy signals hid it), not a skill draft — the lesson is a fact about this codebase, not a repeatable procedure. If it produces a draft instead, the classification rules in Task 2 need sharpening.

- [ ] **Step 5: Confirm live/repo parity.** For every SKILL.md touched under `~/.claude/skills/` (verify-outcome, capture-lesson, session-lock, delegate, ship, land-and-deploy), diff the repo copy against the top-level copy — all must be identical. Report the count verified.

- [ ] **Step 6: Orchestrator self-consistency check.** Read `delegate/SKILL.md` and confirm it states the no-edit constraint explicitly, defines waves by FILE SCOPE (not by task count), and cites `references/independent-verification.md` for its verify step rather than restating the rule. Confirm it also documents when NOT to use the pattern — a skill that never says "don't use me here" gets applied dogmatically.

## Self-Review (done at write time)

- Spec coverage: §1→Tasks 1+4, §2→Task 3, §3→Task 2, §4→Task 5, orchestrator (scope widened)→Task 6, Testing→Task 7, Error handling→embedded (default-UNPROVEN in Task 1, never-auto-activate in Task 2, advisory-lock in Task 5, no-edit constraint in Task 6). No gaps.
- Placeholders: none — every skill's required rule text is specified inline; these skills are prose artifacts, so their "code" is the rule list given.
- Consistency: verdict strings `PROVEN`/`UNPROVEN`/`CONTRADICTED` identical in Tasks 1, 4, 7; the copy-to-top-level requirement repeats in every task that touches a skill; Task 6's verify step delegates to Task 3's reference rather than duplicating it; no consuming project's repository is touched by any task.
