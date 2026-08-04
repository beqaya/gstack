# Tier 1 Failure Guards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the four Tier-1 guards in order — generated-file hook, parity check, failure circuit breaker, falsification step — each validated against the real incident that motivated it.

**Architecture:** One `PreToolUse` hook (the only enforced component), one new skill (`parity`), one bin helper plus a rule (circuit breaker), and one added step in the existing `verify-outcome` skill. Nothing else changes.

**Tech Stack:** Bash/PowerShell hook script, Python 3.13 at `C:/Program Files/Python313/python.exe` for JSON/hash work, gstack SKILL.md conventions.

## Global Constraints

- gstack repo `C:\Users\Person\.claude\skills\gstack`, branch `custom/frontmatter-routing`, push to `fork` only. No consuming project is touched.
- **Skills are GENERATED**: edit `SKILL.md.tmpl` AND `SKILL.md` identically; never run the generator (it rewrites everything). Then copy `SKILL.md` to the live `~/.claude/skills/<name>/`.
- `C:\Users\Person\.claude\settings.json` is the user's LIVE config. Back it up before touching it, validate JSON after, and preserve every existing hook.
- Every artifact must be executable by a fresh agent — instructions that only assert a principle are defects. Include a worked example.
- Do NOT commit; the controller batches commits.

---

### Task 1: Generated-file guard hook

**Files:**
- Create: `C:\Users\Person\.claude\skills\gstack\bin\gstack-generated-guard`
- Modify: `C:\Users\Person\.claude\settings.json` (add one PreToolUse matcher)

**Interfaces:** Produces the hook Task 2's `/parity` message references.

- [ ] **Step 1: Write the guard script.** Reads the PreToolUse JSON payload on stdin, extracts the target path from `tool_input.file_path`. Emits a JSON decision on stdout.

  Detection (first match wins, all case-insensitive on the path):
  1. path lies under any of `.agents/`, `.cursor/`, `.factory/`, `.gbrain/`, `.hermes/`, `.kiro/`, `.openclaw/`, `.opencode/`, `.slate/`
  2. a sibling `<path>.tmpl` exists
  3. the file's first 5 lines contain `AUTO-GENERATED`

  On match, deny with a message naming: the source to edit (`<path>.tmpl` if it exists; else "the resolver/template under scripts/ that emits this"), the regeneration command `bun run gen:skill-docs -- --catalog-mode=full`, and a pointer to `/parity`.

  Override: if the payload's rationale/description contains `GENERATED-EDIT-INTENTIONAL`, allow, and append one JSON line to `~/.gstack/analytics/generated-overrides.jsonl` recording path + timestamp.

  **FAIL OPEN**: wrap everything; on any exception or unreadable path, allow the edit and append a line to `~/.gstack/analytics/guard-errors.jsonl`. A guard that blocks work when broken gets disabled.

- [ ] **Step 2: Test the script directly** before wiring it, by piping synthetic payloads:
  - `qa/SKILL.md` → deny, message names `qa/SKILL.md.tmpl`
  - `scripts/resolvers/browse.ts` → allow
  - `.cursor/skills/gstack-qa/SKILL.md` → deny
  - a path that does not exist → allow (fail open)
  - payload containing the override token → allow + one line in the override log
  Paste each payload and its output.

- [ ] **Step 3: Wire the hook.** Back up settings.json to `settings.json.bak-tier1`. Add a `PreToolUse` entry with matcher `Edit|Write` calling the script. Preserve every existing hook (SessionStart, the existing PreToolUse stash hook, PreCompact, Stop, UserPromptSubmit). Validate the JSON parses.

- [ ] **Step 4: Live test.** Attempt an Edit to a generated file and confirm it is denied with the source named; attempt an Edit to a normal file and confirm it proceeds. Report both.

### Task 2: `/parity` skill

**Files:**
- Create: `gstack\parity\SKILL.md` + `SKILL.md.tmpl`; copy to `~/.claude/skills/parity/SKILL.md`

- [ ] **Step 1: Write the skill.** Rich `description: |` ending ` (gstack)`. Behaviour:
  - Compare each `gstack/<name>/SKILL.md` to `~/.claude/skills/<name>/SKILL.md` by hash.
  - Report four buckets: IDENTICAL (count only), DRIFTED (name + which side is newer by mtime), REPO-ONLY (exists in repo, no live dir — state plainly "invisible to the user"), LIVE-ONLY (live but not in repo — orphan or hand-made).
  - `--sync` copies repo → live for DRIFTED and REPO-ONLY, then re-verifies by hash and reports the new counts. NEVER copies live → repo; say why in the skill (it would launder a hand-edit into version control).
  - `--sync` refuses if the repo working tree is dirty for the files it would copy; tell the user to commit or stash first.
  - Include concrete commands that work on this machine, and a worked example showing one drifted skill being detected and synced.

- [ ] **Step 2:** Validate frontmatter; copy to live; diff-verify identical.
- [ ] **Step 3:** Prove it works: deliberately desync one skill, run the check, confirm DRIFTED, run `--sync`, confirm IDENTICAL. Paste output.

### Task 3: Failure circuit breaker

**Files:**
- Create: `gstack\bin\gstack-failure-count`
- Create: `gstack\references\failure-circuit-breaker.md`
- Modify: `C:\Users\Person\.claude\CLAUDE.md` (one bullet under "How to work")

- [ ] **Step 1: Write the counter.** `gstack-failure-count <task-id> [--record same|different|infra] [--reset] [--status]`, storing JSON under `~/.gstack/failures/<task-id>.json` with `consecutive_same`, `total`, `infra_count`, `last_action_hash`. Prints `CONTINUE` or `BREAK` on `--record`.

  Thresholds: BREAK at 3 consecutive same-action failures OR 10 total in one task. Infra errors (`ENOTFOUND`, `ConnectionRefused`, `ETIMEDOUT`, HTTP 5xx) do NOT count on their first two occurrences; from the third they count as normal failures.

- [ ] **Step 2: Write the reference doc** with the rule, the thresholds, the summary format (what was attempted / what each returned / what they have in common / two likeliest explanations), and the three anti-rationalizations verbatim from the spec ("this attempt is different", "one more will do it", "the failure is transient"), each with its counter. Include the real 267009 incident as the worked example.

- [ ] **Step 3: Add ONE bullet to CLAUDE.md** under "How to work". Read the file fresh from disk first — several agents edited it this session. Do not disturb neighbouring bullets.

- [ ] **Step 4: Test the counter:** record three same-action failures → third prints BREAK; reset; record two infra failures → both CONTINUE; third infra → BREAK counting begins. Paste output.

### Task 4: Falsification step in `verify-outcome`

**Files:**
- Modify: `gstack\verify-outcome\SKILL.md` AND `SKILL.md.tmpl`; re-copy to live.

- [ ] **Step 1: Insert Step B2** between Step B and Step C:
  > **Step B2 — name the falsifier.** Before recording a verdict, state the single observation that would prove this claim WRONG, then go make that observation. If you cannot name one, you do not understand the claim well enough to verify it. The falsifier must be something you have NOT already checked — naming a check you already ran is confirmation, not falsification.

  Embed the worked example: the claim "the CSP is fixed so PostHog works"; the checks that passed (typecheck, four green workflows, deploy success, changed response header, page renders); the falsifier not run (open the browser console and look for refusals); the result (five scripts still blocked by a second directive, fix half done).

- [ ] **Step 2:** Apply to both `.md` and `.tmpl`; re-copy to live; diff-verify.

- [ ] **Step 3: ACCEPTANCE TEST.** Apply the amended skill's rules to the mid-fix CSP state (connect-src fixed, script-src not; deploy green, header changed, page rendering). It MUST reach CONTRADICTED via the console. State the determination and the reasoning chain. If it reaches PROVEN, Step B2's wording is too weak — strengthen and re-run.

### Task 5: Verify all four together

- [ ] **Step 1:** Re-run each task's own test and confirm all still pass after the others landed.
- [ ] **Step 2:** Confirm the hook did not break normal editing — edit a non-generated file in a scratch dir.
- [ ] **Step 3:** Run `/parity` and confirm zero drift across all skills.
- [ ] **Step 4:** Confirm `settings.json` still parses and every pre-existing hook is present.

## Self-Review (at write time)

- Spec coverage: §1→Task 1, §2→Task 2, §3→Task 3, §4→Task 4, Verification→each task's test + Task 5. No gaps.
- Ordering matches the founder's instruction (1→4) and dependency: Task 1's deny message references `/parity` from Task 2, so Task 2's name is fixed in Task 1's text and created in Task 2 — noted so Task 1 does not block.
- Enforcement honesty: only Task 1 is enforced; Tasks 2-4 are guidance and the artifacts must say so.
