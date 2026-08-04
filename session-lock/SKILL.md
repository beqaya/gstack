---
name: session-lock
version: 1.0.0
description: |
  Advisory locking so multiple concurrent agent sessions don't clobber the same
  shared status/tracker file. Takes the tracker's path as an argument -- it
  never assumes a project's layout, section headers, or row format, and it
  never edits a project's .gitignore (it tells the user the line to add
  instead). Creates a lock file beside the tracker containing a session id and
  an ISO-8601 UTC timestamp; a lock under 30 minutes old is HELD (do not
  write, report the holder and coordinate); a lock 30 minutes or older is
  STALE (may be broken, but the breaking session must say so and name whose
  lock it broke). The lock is advisory, never a hard block on an emergency
  fix -- overriding it must be stated out loud, never done silently. Use when
  asked to "claim the board", "take the lock", "who owns this", "coordinate
  before writing the tracker", or whenever more than one agent session is
  working the same repo. (gstack)
triggers:
  - claim the board
  - take the lock
  - who owns this
  - lock the tracker
  - coordinate before writing
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---

# /session-lock -- Advisory Locking for a Shared Tracker File

Two agent sessions writing the same status/tracker file at the same time will
silently overwrite each other's edits. This skill is the coordination point:
acquire the lock immediately before you write the tracker, release it
immediately after, and treat someone else's fresh lock as a hard "don't write
right now, go coordinate."

**Motivating incident:** on 2026-08-03, two agent sessions pushed to the same
repository's main branch within minutes of each other. The convention to
coordinate first existed in a status doc, but nothing actually enforced it --
both sessions read the doc, both believed they were clear, both pushed. This
skill is the enforcement that doc-only convention was missing.

**This skill is PROJECT-AGNOSTIC.** It knows nothing about any project's
section headers, row format, or file layout beyond the one path it is given.
Never hard-code a project's tracker structure into this skill, and never
extend it to parse or rewrite the tracker's contents -- it only manages the
lock file beside the tracker, never the tracker itself.

## User-invocable

When the user or another skill says "claim the board", "take the lock", or
needs to write a shared tracker, run this skill with the tracker path before
that write happens.

---

## Step 1: Resolve the tracker path

- If a tracker path was given as an argument, use it exactly as given
  (relative to the current working directory, or absolute).
- If no path was given: check whether `docs/STATUS.md` exists relative to the
  current working directory. If it exists, use it. **If it does not exist,
  STOP and ask the caller for the tracker path** -- do not guess a project's
  layout, and do not invent a different default filename.

All examples below use `$TrackerPath` for this resolved path.

## Step 2: Derive the lock path and a session id

The lock file lives beside the tracker, named `.<tracker filename>.lock`. For
`docs\STATUS.md` that is `docs\.STATUS.md.lock`.

You need a session id that distinguishes this working session from any
other. If your harness exposes a real session/thread id, use that string
directly. Otherwise generate one -- it only has to be locally unique and
human-readable when reported back.

PowerShell (primary shell on this machine):

```powershell
$TrackerPath = "docs\STATUS.md"
$LockPath = Join-Path (Split-Path $TrackerPath) (".$(Split-Path $TrackerPath -Leaf).lock")
$SessionId = "$env:USERNAME-$([guid]::NewGuid().ToString().Substring(0,8))"
```

**Windows PowerShell gotcha, verified during this skill's own testing:** if you
use `[System.IO.File]` / `[System.IO.Directory]` static methods (Step 3 below)
with a RELATIVE `$LockPath`, .NET resolves it against
`Environment.CurrentDirectory`, which is a SEPARATE value from PowerShell's
own `$PWD` -- after `Set-Location`/`cd`, the two silently diverge, and the
lock file gets created in the wrong directory with no error. Always run this
line first, once per session, before any `[System.IO.File]::Open` call:

```powershell
[System.IO.Directory]::SetCurrentDirectory($PWD.Path)
```

## Step 3: Acquire the lock (atomic create-or-fail)

Atomicity matters here: two sessions must never both believe they got the
lock. Use `[System.IO.FileMode]::CreateNew`, which maps to the Windows
`CREATE_NEW` file-creation flag -- the OS itself refuses the second create,
so there is no race window between "check if it exists" and "create it".

PowerShell (assumes PowerShell; run from the repo root or adjust paths):

```powershell
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
try {
    $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$SessionId $Timestamp")
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    Write-Output "ACQUIRED by $SessionId at $Timestamp"
} catch [System.IO.IOException] {
    Write-Output "LOCK EXISTS -- go read it before writing (Step 4)"
}
```

Git Bash equivalent (assumes Git Bash; `os.O_EXCL` gives the same atomic
create-or-fail guarantee at the OS level):

```bash
"C:/Program Files/Python313/python.exe" -c "import sys,os,datetime; lock=sys.argv[1]; sid=sys.argv[2]; ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'); exec('try:\n fd=os.open(lock, os.O_CREAT|os.O_EXCL|os.O_WRONLY)\n os.write(fd, (sid+chr(32)+ts).encode())\n os.close(fd)\n print(\"ACQUIRED\", ts)\nexcept FileExistsError:\n print(\"LOCK EXISTS\")')" "docs/.STATUS.md.lock" "$SessionId"
```

If you got `ACQUIRED`, write the tracker now, then go straight to Step 6
(release). If you got `LOCK EXISTS` / `LOCK EXISTS -- go read it`, go to
Step 4.

## Step 4: Read the existing lock and compute its age

PowerShell:

```powershell
$LockContent = (Get-Content $LockPath -Raw).Trim()
$Parts = $LockContent -split ' ', 2
$HolderSession = $Parts[0]
$LockTimestamp = [datetime]::ParseExact($Parts[1], "yyyy-MM-ddTHH:mm:ssZ", $null, [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal)
$AgeMinutes = ((Get-Date).ToUniversalTime() - $LockTimestamp).TotalMinutes
$IsStale = $AgeMinutes -ge 30
Write-Output "Held by $HolderSession, age $([math]::Round($AgeMinutes,1)) min, stale=$IsStale"
```

## Step 5: Decide -- HELD or STALE

- **Age < 30 minutes -> HELD.** Do NOT write the tracker. Report which
  session holds it (`$HolderSession`) and for how long
  (`$AgeMinutes` rounded). Coordinate with that session (or the user) instead
  of clobbering it. Re-check later, or ask the user how to proceed.
- **Age >= 30 minutes -> STALE.** You MAY break it: delete the lock file
  (Step 6's delete command) and then acquire your own (Step 3). When you do,
  your output MUST explicitly say you broke a stale lock and name whose it
  was, e.g. `"Broke stale lock held by <HolderSession> (age 41.2 min), now held by <SessionId>"`.
  Do not silently overwrite it without saying so.

**Advisory, not a hard gate.** This lock must never block a genuine emergency
fix. If circumstances require writing anyway while a fresh (non-stale) lock
is HELD, that is allowed -- but you must say so out loud in your output
("bypassing an active lock held by `<HolderSession>` because `<reason>`"),
never bypass it silently. Silent override is the one thing this protocol
forbids; a stated, deliberate override is legal.

## Step 6: Release the lock

Release immediately after the tracker write completes -- do not leave the
lock held while doing unrelated work.

PowerShell:

```powershell
Remove-Item -Path $LockPath -Force
```

Git Bash:

```bash
rm -f "docs/.STATUS.md.lock"
```

## Step 7: Tell the user to gitignore the lock pattern

This skill NEVER edits any project's `.gitignore` itself. Instead, tell the
user the exact line to add for the tracker they're using, e.g. for
`docs\STATUS.md`:

> Add `docs/.STATUS.md.lock` to this repo's `.gitignore` so lock files never
> get committed.

If the project already ignores dotfiles broadly (`.*`), say that this is
already covered instead of asking for a redundant line.

---

## Worked example

Two sessions are both working `C:\work\example-repo` (any repo -- this skill
does not care which one), tracker is `docs\STATUS.md`. This mirrors the
2026-08-03 incident above, except this time the lock actually stops the
collision.

1. **Session A** wants to update `docs\STATUS.md`. It resolves
   `$TrackerPath = "docs\STATUS.md"`, `$LockPath = "docs\.STATUS.md.lock"`,
   `$SessionId = "sess-9f3a1c2b"`. It runs the Step 3 acquire command.
   Output: `ACQUIRED by sess-9f3a1c2b at 2026-08-03T14:02:11Z`. Session A
   writes its tracker update.

2. **Session B**, four minutes later, wants to update the same tracker. It
   derives the same `$LockPath` and runs the same Step 3 acquire command.
   Output: `LOCK EXISTS -- go read it before writing (Step 4)`. Session B
   runs the Step 4 read command. Output:
   `Held by sess-9f3a1c2b, age 4.1 min, stale=False`. Per Step 5, this is
   HELD -- Session B does NOT write. It reports to its user: "docs\STATUS.md
   is locked by session sess-9f3a1c2b, held 4.1 minutes -- waiting" and
   either polls again shortly or asks the user how to proceed.

3. **Session A** finishes its write and immediately runs the Step 6 release
   command (`Remove-Item -Path "docs\.STATUS.md.lock" -Force`). The lock file
   is gone.

4. **Session B** retries the Step 3 acquire command. Output:
   `ACQUIRED by <SessionB-id> at <timestamp>`. It writes its own update and
   releases when done. No collision, unlike the incident this skill exists to
   prevent.

5. **Stale-lock variant:** suppose Session A had crashed instead of releasing.
   35 minutes later, Session B's Step 4 read shows
   `Held by sess-9f3a1c2b, age 35.0 min, stale=True`. Per Step 5, Session B
   deletes the lock (Step 6 command) and immediately re-acquires (Step 3),
   then reports: `"Broke stale lock held by sess-9f3a1c2b (age 35.0 min), now held by <SessionB-id>"`.
   It does NOT attempt to add a note about this into `docs\STATUS.md` itself
   -- this skill does not know that tracker's row format, so the break is
   recorded only in the session's own output, never by editing the tracker's
   content.

---

## Output

Report exactly one of `ACQUIRED`, `HELD (waiting)`, `STALE (broken, now held)`,
or `RELEASED`, plus the holder session id and age when relevant. Never report
a tracker write as done without having released the lock afterward.
