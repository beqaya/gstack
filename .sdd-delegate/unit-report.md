# Unit report: Windows `.exe` binary-resolution fix

## Status: DONE — all 3 in-scope files edited, verified, not committed

Files touched (verified via `git status --porcelain`, nothing else changed):
- `scripts/resolvers/browse.ts`
- `scripts/resolvers/design.ts`
- `scripts/app/gstack-browser`

## Binaries found affected

Grepped both resolver files for every `dist/<bin>` resolution site:

| File | Function | Binary resolved | Site(s) |
|---|---|---|---|
| `browse.ts` | `generateBrowseSetup` | `browse` | line ~108 (`B=`) |
| `design.ts` | `generateDesignSetup` | `design` | line ~794 (`D=`) |
| `design.ts` | `generateDesignSetup` | `browse` | line ~802 (`B=`) |
| `design.ts` | `generateDesignMockup` | `design` | line ~839 (`D=`) |
| `gstack-browser` | candidate loop | `browse` | line ~52 |

`find-browse` and `make-pdf`/`dist/pdf` do **not** appear in any of the three files
(`grep -n 'find-browse\|dist/pdf\|makePdfDir' scripts/resolvers/browse.ts scripts/resolvers/design.ts scripts/app/gstack-browser` → no matches). `find-browse` resolution lives entirely in `browse/bin/find-browse` + `browse/src/find-browse.ts`, which per CHANGELOG.md is already `.exe`/`.cmd`/`.bat`-aware — out of scope and untouched. So 5 sites total, all fixed.

## The fix, verbatim (as it now reads on disk)

### `scripts/resolvers/browse.ts` — `generateBrowseSetup` (bash block)
```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
B=""
if [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse" ]; then
  B="$_ROOT/.claude/skills/gstack/browse/dist/browse"
elif [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse.exe" ]; then
  B="$_ROOT/.claude/skills/gstack/browse/dist/browse.exe"
elif [ -x "$HOME/.claude/skills/gstack/browse/dist/browse" ]; then
  B="$HOME/.claude/skills/gstack/browse/dist/browse"
elif [ -x "$HOME/.claude/skills/gstack/browse/dist/browse.exe" ]; then
  B="$HOME/.claude/skills/gstack/browse/dist/browse.exe"
fi
if [ -x "$B" ]; then
  echo "READY: $B"
else
  echo "NEEDS_SETUP"
fi
```
(`${ctx.paths.localSkillRoot}` / `${ctx.paths.browseDir...}` template interpolations shown here already
resolved for the `claude` host — the actual source keeps the interpolation expressions, other hosts
substitute their own root/env-var paths unchanged.)

Doc string updated (line 57, `generateSnapshotFlags`):
> `` `$B` is the browse binary (resolved from `$_ROOT/.claude/skills/gstack/browse/dist/browse` or `~/.claude/skills/gstack/browse/dist/browse`, trying the `.exe` suffix at each location too — the compiled binary is named `browse.exe` on Windows). ``

### `scripts/resolvers/design.ts` — `generateDesignSetup` (bash block, D then B)
```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
D=""
if [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/design/dist/design" ]; then
  D="$_ROOT/.claude/skills/gstack/design/dist/design"
elif [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/design/dist/design.exe" ]; then
  D="$_ROOT/.claude/skills/gstack/design/dist/design.exe"
elif [ -x "$HOME/.claude/skills/gstack/design/dist/design" ]; then
  D="$HOME/.claude/skills/gstack/design/dist/design"
elif [ -x "$HOME/.claude/skills/gstack/design/dist/design.exe" ]; then
  D="$HOME/.claude/skills/gstack/design/dist/design.exe"
fi
if [ -x "$D" ]; then
  echo "DESIGN_READY: $D"
else
  echo "DESIGN_NOT_AVAILABLE"
fi
B=""
if [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse" ]; then
  B="$_ROOT/.claude/skills/gstack/browse/dist/browse"
elif [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse.exe" ]; then
  B="$_ROOT/.claude/skills/gstack/browse/dist/browse.exe"
elif [ -x "$HOME/.claude/skills/gstack/browse/dist/browse" ]; then
  B="$HOME/.claude/skills/gstack/browse/dist/browse"
elif [ -x "$HOME/.claude/skills/gstack/browse/dist/browse.exe" ]; then
  B="$HOME/.claude/skills/gstack/browse/dist/browse.exe"
fi
if [ -x "$B" ]; then
  echo "BROWSE_READY: $B"
else
  echo "BROWSE_NOT_AVAILABLE (will use 'open' to view comparison boards)"
fi
```

### `scripts/resolvers/design.ts` — `generateDesignMockup` (bash block)
```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
D=""
if [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/design/dist/design" ]; then
  D="$_ROOT/.claude/skills/gstack/design/dist/design"
elif [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/design/dist/design.exe" ]; then
  D="$_ROOT/.claude/skills/gstack/design/dist/design.exe"
elif [ -x "$HOME/.claude/skills/gstack/design/dist/design" ]; then
  D="$HOME/.claude/skills/gstack/design/dist/design"
elif [ -x "$HOME/.claude/skills/gstack/design/dist/design.exe" ]; then
  D="$HOME/.claude/skills/gstack/design/dist/design.exe"
fi
[ -x "$D" ] && echo "DESIGN_READY" || echo "DESIGN_NOT_AVAILABLE"
```
Kept as the bare no-path echo form (`DESIGN_READY` / `DESIGN_NOT_AVAILABLE`, no colon, no path) — the
downstream prose in that section branches on those exact literal tokens, unlike `generateDesignSetup`'s
`DESIGN_READY: $D` form.

### `scripts/app/gstack-browser` — candidate loop (line 52)
```bash
BROWSE_BIN=""
for candidate in "$DIR/browse" "$DIR/browse.exe" "$DIR/browse/dist/browse" "$DIR/browse/dist/browse.exe" "$HOME/.claude/skills/gstack/browse/dist/browse" "$HOME/.claude/skills/gstack/browse/dist/browse.exe"; do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    BROWSE_BIN="$candidate"
    break
  fi
done
```
`.exe` sibling added immediately after each of the 3 pre-existing candidates; precedence order
(bundle `$DIR/browse` → bundle `$DIR/browse/dist/browse` → global `$HOME/...`) unchanged.

All four blocks kept structurally independent (no shared shell helper) — each gets pasted standalone
into a generated `SKILL.md`, so cross-block coupling would break the generator's per-skill composition.

## Verification transcript

Method: rather than hand-retype the shell logic, I ran the actual TypeScript resolver functions via
`bun` (imported `generateBrowseSetup`/`generateDesignSetup`/`generateDesignMockup` from the real
files on disk, using `HOST_PATHS['claude']` as `ctx.paths`), regex-extracted the fenced ```bash block
from each function's Markdown output, and executed those extracted scripts — so what got tested is
byte-identical to what the edited source files emit, not a re-implementation of my intent.

Helper script and outputs live under `C:\Users\Person\AppData\Local\Temp\gstack-verify\` (outside the
repo, per file-scope — nothing was written to the gstack repo besides the 3 in-scope files and this
report).

### Extraction + diff-to-source sanity check
```
$ bun run C:\Users\Person\AppData\Local\Temp\gstack-verify\extract-snippets.ts
WROTE browseSetup, designSetup, designMockup
```
Confirmed each extracted `.sh` file's `if/elif` chain textually matches the corresponding block in the
edited `.ts` source (shown side-by-side above) — same 4-branch structure, same variable, same order.

### Test A — real filesystem, real `$HOME` (ground truth: only `.exe` binaries exist)
```
$ cd C:\Users\Person\.claude\skills\gstack
$ bash /tmp/gstack-verify/browseSetup.sh
READY: /c/Users/Person/.claude/skills/gstack/browse/dist/browse
$ bash /tmp/gstack-verify/designSetup.sh
DESIGN_READY: /c/Users/Person/.claude/skills/gstack/design/dist/design
BROWSE_READY: /c/Users/Person/.claude/skills/gstack/browse/dist/browse
$ bash /tmp/gstack-verify/designMockup.sh
DESIGN_READY
```
All three resolve successfully against the real, current `~/.claude/skills/gstack` install — no
`NEEDS_SETUP`/`NOT_AVAILABLE` despite only `.exe` files being present on disk. (Run from inside the
gstack repo itself, so `_ROOT` = `~/.claude/skills/gstack`; the local candidate becomes
`.../gstack/.claude/skills/gstack/browse/dist/browse[.exe]`, which correctly does **not** exist, so
resolution falls through to the `$HOME` branch — which is what actually resolves here. This is noted
so it doesn't read as a miss: the local-repo branch is exercised separately below in the fixture
tests, where `_ROOT` is pointed at a directory that actually has the file.)

**Important finding, disclosed rather than hidden:** this machine's Git-for-Windows/MSYS `bash` has a
compatibility shim where `[ -x "path/browse" ]` (and direct `exec` of that same bare path) silently
resolves to `path/browse.exe` if the exact name doesn't exist — confirmed by instrumenting the
extracted script with a `$LINENO` trace and rerunning it against a fixture containing *only*
`browse.exe`: the trace showed the plain (no-`.exe`) `if` branch firing and succeeding, before the
`.exe`-specific `elif` branch was ever reached. This means, on this specific shell, even the *old*
buggy resolution line could by chance return a working path in some configurations, which is why I
did not rely on "does it print READY" as the sole signal — the tests below are constructed so the
shim can't paper over what's actually being verified: whether the resolver ever computes a **dangling
path to a file that doesn't exist under any name**, and whether repo-local strictly outranks `$HOME`.

### Isolated fixture tests (fabricated `$_ROOT` / `$HOME`, immune to the real-install shim question)

Built 4 fixtures under `/tmp/gstack-verify/scenarios/`:
- **s1**: real `git init`'d repo containing `.claude/skills/gstack/browse/dist/browse.exe` +
  `design/dist/design.exe` (chmod +x), **no extensionless copies**. Separate empty fake `$HOME`.
- **s2**: a directory that is *not* a git repo (so `$_ROOT` resolves empty) + fake `$HOME` containing
  only the **extensionless** `browse`/`design` (chmod +x), no `.exe`.
- **s3**: not a git repo + fake `$HOME`, **both completely empty** — nothing exists under any name.
- **s4** (precedence): real repo containing only `browse.exe` locally, and a *separate* fake `$HOME`
  containing only the extensionless `browse` — tests that repo-local `.exe` outranks `$HOME`
  extensionless, which would fail under a wrong implementation that checks "location" before
  "extension" instead of the reverse.

```
===== SCENARIO 1: repo-local .exe only, HOME empty (expect READY -> repo .exe) =====
READY: .../scenarios/s1/repo/.claude/skills/gstack/browse/dist/browse

===== SCENARIO 2: no repo, HOME extensionless only (expect READY -> HOME extensionless) =====
READY: /tmp/gstack-verify/scenarios/s2/home/.claude/skills/gstack/browse/dist/browse

===== SCENARIO 3: nothing exists anywhere (expect NEEDS_SETUP, no crash) =====
NEEDS_SETUP

===== SCENARIO 4: precedence — repo .exe AND home extensionless both present (expect repo .exe wins) =====
READY: .../scenarios/s4/repo/.claude/skills/gstack/browse/dist/browse
```

Scenario 3 is the decisive one: `$B` never gets assigned to a nonexistent path — it stays `""` and the
block correctly prints `NEEDS_SETUP`. That's exactly the bug class described in the task (old code's
`[ -z "$B" ] && B="$HOME/.../browse"` assigned unconditionally, regardless of whether that path
existed) — it's structurally gone: every assignment in the new code is now gated by its own `-x`
check.

Same 4 scenarios repeated for `design.ts`'s two blocks:
```
===== designSetup — SCENARIO 1: repo .exe only for both design+browse =====
DESIGN_READY: .../s1/repo/.claude/skills/gstack/design/dist/design
BROWSE_READY: .../s1/repo/.claude/skills/gstack/browse/dist/browse

===== designSetup — SCENARIO 2: no repo, HOME extensionless only =====
DESIGN_READY: /tmp/gstack-verify/scenarios/s2/home/.claude/skills/gstack/design/dist/design
BROWSE_READY: /tmp/gstack-verify/scenarios/s2/home/.claude/skills/gstack/browse/dist/browse

===== designSetup — SCENARIO 3: nothing exists anywhere (expect both NOT_AVAILABLE, no dangling path) =====
DESIGN_NOT_AVAILABLE
BROWSE_NOT_AVAILABLE (will use 'open' to view comparison boards)

===== designMockup — SCENARIO 1 (expect DESIGN_READY) =====
DESIGN_READY

===== designMockup — SCENARIO 3 (expect DESIGN_NOT_AVAILABLE) =====
DESIGN_NOT_AVAILABLE
```

### `gstack-browser` candidate loop — extracted verbatim and diffed against source
```
$ diff <(sed -n '52,57p' scripts/app/gstack-browser) <(sed -n '2,7p' /tmp/gstack-verify/gstack-browser-loop.sh)
SNIPPET MATCHES SOURCE FILE VERBATIM
```
```
===== DIR = fixture with only browse.exe under dist, HOME = empty fixture =====
RESOLVED: /tmp/gstack-verify/scenarios/s1/repo/.claude/skills/gstack/browse/dist/browse

===== DIR = nonexistent, HOME = fixture with only extensionless browse =====
RESOLVED: /tmp/gstack-verify/scenarios/s2/home/.claude/skills/gstack/browse/dist/browse

===== DIR = nonexistent, HOME = empty fixture (expect ERROR, exit 1, no dangling $BROWSE_BIN) =====
ERROR: browse binary not found.
EXIT=1
```
`$BROWSE_BIN` is only ever set inside the `-f && -x` guard in the loop body, so there's no separate
unconditional-fallback bug here to eliminate (this file's original bug was purely "no `.exe` candidate
listed at all," per the task description) — the 6-candidate loop with `.exe` siblings resolves both
extension forms at both locations, and correctly exits 1 with an explicit error (not a silent bad
path) when nothing is found.

### Sanity: repo scope + no stray edits
```
$ git status --porcelain
 M scripts/app/gstack-browser
 M scripts/resolvers/browse.ts
 M scripts/resolvers/design.ts
```
Only the 3 in-scope files touched. Not committed, per instructions. `gen:skill-docs` was not run.

`bun run <extract-script>` imports and executes both `.ts` resolver files without error (bun
transpiles + runs TS directly), confirming the edited files are syntactically valid; no repo-root
`tsconfig.json` exists to run a full `tsc --noEmit` pass (`bunx tsc --noEmit -p .` → `TS5081: Cannot
find a tsconfig.json`), so this is as far as static verification goes without invoking the doc
generator, which was explicitly out of scope.
