---
name: parity
version: 1.0.0
description: |
  Detects gstack repo edits that never reached the live copies a user runs. The
  live skills at `~/.claude/skills/<name>/SKILL.md` are COPIES of the repo's, so
  a correct repo edit changes nothing until someone copies it. Compares every
  skill to its live counterpart by SHA-256 and reports four buckets: IDENTICAL,
  DRIFTED (which side is newer), REPO-ONLY (invisible to the user), and
  LIVE-ONLY (informational). `--sync` copies repo to live for DRIFTED and REPO-ONLY, re-verifies
  by hash, and refuses when the working tree has uncommitted changes to a file
  it would copy. Sync is one-directional and NEVER copies live back to the repo:
  a live-side hand-edit landing in version control would be committed as if it
  were reviewed source. Use when asked to "check parity", "did my skill edit
  actually land", "sync skills to live", or "why isn't my SKILL.md change
  showing up". (gstack)
triggers:
  - check parity
  - is my skill edit live
  - sync skills to live
  - why isn't my change showing up
  - parity check
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

# /parity -- Repo-to-Live Skill Drift Detector

The gstack repo lives at `C:\Users\Person\.claude\skills\gstack`. Every skill
a user actually runs lives one level up, at `C:\Users\Person\.claude\skills\<name>\SKILL.md`
-- a plain file COPY of `C:\Users\Person\.claude\skills\gstack\<name>\SKILL.md`,
not a junction and not a symlink. Editing the repo file is necessary but not
sufficient: until something copies it, the user's live skill is unchanged.

**Motivating incident:** every task in the plan that produced this skill
needed a manual copy-and-check after each repo edit, and one implementer died
mid-session after editing the repo but before copying, leaving repo and live
silently divergent with no error from anything. This skill is the check that
would have caught it immediately instead of leaving it for the next person to
discover by surprise.

**One-directional by design.** This skill only ever copies repo -> live, never
live -> repo. If it copied live -> repo, a hand-edit made directly against the
live copy (bypassing review, bypassing the `.tmpl` source, bypassing git
entirely) would get silently absorbed into version control the next time
someone ran `/parity --sync` -- laundering an unreviewed edit into the
project's history as if it had gone through the normal edit path. When live
is newer than repo, that is surfaced as DRIFTED with live named as the newer
side; a human decides whether to port that change into the repo by hand, or
discard it. `/parity` will never make that decision for you.

## User-invocable

Run this when asked to check parity, when a repo skill edit doesn't seem to
be affecting live behavior, before trusting that a skill edit is live, or
periodically as an audit across all 57+ gstack skills.

---

## Step 1: Run the check (no `--sync`)

The checker is `bin/gstack-parity-check` -- plain-stdlib Python, so it runs
the same from PowerShell or Git Bash. It used to be a heredoc this skill
wrote to `$TEMP` on every run; it is a real script now so that the skill and
the session-start hook run the identical code and cannot drift apart.

```bash
"C:/Program Files/Python313/python.exe" ~/.claude/skills/gstack/bin/gstack-parity-check
```

`--hook` is the session-start form: it prints only when something has
drifted and always exits 0, so a stale copy is announced before the first
tool call instead of discovered after a change "didn't take".

## Step 2: Read the buckets

- **IDENTICAL** -- count only. These are fine; do not enumerate them, that's
  noise.
- **DRIFTED** -- name each one, and say which side is newer. Newer-repo means
  an edit landed in the repo but was never copied out (the exact failure mode
  this skill exists to catch). Newer-live means someone hand-edited the live
  copy directly -- flag it, do not auto-resolve it by syncing without telling
  the user, since `--sync` will overwrite that live edit with the repo's
  (older) version.
- **REPO-ONLY** -- state plainly: "invisible to the user" until synced. A
  brand-new skill added to the repo lands here until the first sync.
- **LIVE-ONLY** -- informational, not a defect. Expect real entries here:
  skills that were never part of the gstack repo at all (e.g. `briefing`,
  `recall`, `reflect`, `gstack-evolve`, `deploy-topology`, `gcp-setup`,
  `skills-cheatsheet`, the entire `cyberteam` suite, `_gstack-command`), plus
  any project's own hand-authored skills. Never report a LIVE-ONLY skill as
  broken or missing just because it has no repo counterpart.

## Step 3: `--sync` if asked to fix drift

Add `--sync` to the same script invocation:

```powershell
"C:/Program Files/Python313/python.exe" ~/.claude/skills/gstack/bin/gstack-parity-check --sync
```

This copies **repo -> live only**, for DRIFTED and REPO-ONLY skills. It never
touches a skill that is already IDENTICAL, and it never writes anything back
into the repo. Before copying anything, it runs `git status --porcelain` on
exactly the repo files it's about to copy; if any of them show uncommitted
changes, it refuses the whole sync and prints the dirty paths -- commit or
stash those repo changes first, then re-run. This exists so a sync never
locks in an unreviewed, uncommitted repo edit as the new live truth.

After copying, it re-hashes every file it just copied and prints post-sync
IDENTICAL/DRIFTED counts. A name still appearing under post-sync DRIFTED
means the copy didn't take -- investigate (locked file, permissions, AV
scanner holding a handle) rather than assuming the skill worked.

---

## Worked example

Starting state (this session, verified): 57 repo skills under
`C:\Users\Person\.claude\skills\gstack\<name>\SKILL.md`, all 57 hash-identical
to their live counterparts, plus ~76 LIVE-ONLY skills (the cyberteam suite,
`briefing`/`recall`/`reflect`/etc., `_gstack-command`) that were never part of
the repo and are correctly excluded from any error bucket.

1. **Desync `session-lock` deliberately**, by appending a byte directly to
   the *live* copy without touching the repo (this simulates the exact
   incident: a live copy diverges and nothing notices):

   ```powershell
   Add-Content -Path "$HOME\.claude\skills\session-lock\SKILL.md" -Value "`n<!-- drift test -->" -NoNewline:$false
   ```

2. **Run Step 1's check.** Output includes:

   ```
   DRIFTED: 1
     session-lock -- live is newer
   ```

   Every other repo skill still reports IDENTICAL, because this comparison
   is per-file, not all-or-nothing.

3. **Run `--sync`.** Since only the *live* file was touched, the repo's
   `session-lock/SKILL.md` has zero uncommitted changes -- the dirty-check
   passes trivially and the sync proceeds. Output:

   ```
   SYNCING 1 file(s), repo -> live only:
     copied session-lock

   --- post-sync ---
   IDENTICAL: 57
   DRIFTED: 0
   ```

   The repo's original content overwrote the live hand-edit -- exactly the
   "repo wins on sync" behavior this skill promises. Nothing was ever written
   back into the repo; the appended `<!-- drift test -->` line only ever
   existed on the live side and is now gone, replaced by the repo's clean
   version.

4. **Contrast case -- a dirty repo file.** If instead you edit
   `C:\Users\Person\.claude\skills\gstack\session-lock\SKILL.md` (the repo
   copy) and run `--sync` before committing, `git status --porcelain` on
   `session-lock/SKILL.md` returns a non-empty line, so the sync refuses
   outright and prints:

   ```
   SYNC REFUSED: repo working tree is dirty for files it would copy:
    M session-lock/SKILL.md
   Commit or stash the repo changes first, then re-run --sync.
   ```

   No file is touched in this case, live or repo.

## Output

Report the four bucket counts every run. On a `--sync` run, also report the
post-sync counts and name anything still DRIFTED after the copy attempt.
Never claim a repo edit is "done" or "shipped" without an IDENTICAL result
from this check on the affected skill(s) -- a green repo diff and a passing
test are not evidence the live copy changed; see `/verify-outcome`.
