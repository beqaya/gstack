# Make Windows breakage visible — design spec

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan
**Repo:** gstack (`~/.claude/skills/gstack`), branch `windows-fixes-and-enhancements` (local; not upstream)
**Author:** brainstormed with user (beqaya)

## Problem

gstack is already heavily Windows-hardened, but Windows-specific regressions still reach users because CI does not exercise most of the suite on Windows, and some Windows-relevant tests cannot run on a stock (non-Developer-Mode) Windows box at all. Verified 2026-07-15:

1. **CI over-excludes: only ~55% of the free suite runs on `windows-latest`.** `scripts/test-free-shards.ts:53-94` classifies a test as Windows-fragile via source-content regexes. The pattern at line 74 flags *any* test that references a `bin/` path (`,\s*['"]bin['"]\s*[,)]|['"]\.?\/?bin\/[a-z][\w-]+['"]`) — **76 of 155 total exclusions**. But the real Windows failure mode is only **direct** execution of a shebang script (`spawnSync(scriptPath, …)`, which Windows `CreateProcess` cannot parse). Tests that spawn via `spawnSync('bash', [scriptPath, …])` are already Windows-safe, yet are excluded. Spot-checked ~15 flagged files (`gstack-config.test.ts`, `hook-scripts.test.ts`, `uninstall.test.ts`, `diff-scope.test.ts`, …) — all already wrap the spawn as `spawnSync('bash', …)`. Result: 189/344 free tests run on Windows CI.

2. **Install/uninstall tests can't run on Windows.** 15 test files (`grep -rl symlinkSync test/ browse/test/`) call raw `fs.symlinkSync`, which throws `EPERM` on Windows without Developer Mode. Reproduced live: `bun test test/uninstall.test.ts` → **3 pass, 4 fail**, all `EPERM: operation not permitted, symlink`. Production `setup` already solved this exact problem via `_link_or_copy` (`setup:43-64`: symlink on Unix, copy on Windows, with a static-invariant guard in `test/setup-windows-fallback.test.ts`) — but the tests never got the JS equivalent. So the install/uninstall skill-linking logic, the code most likely to regress for Windows users, has no working Windows test coverage.

3. **~57 of ~66 e2e tests run in no CI workflow (silent test-rot).** `.github/workflows/evals-periodic.yml` hardcodes a ~9-file matrix; `evals.yml` (the gate) covers 14; the rest run only when local diff-selection happens to touch them. `CHANGELOG.md` v1.60.1.0 documents an eval that was broken for months, found by accident, with a note that this is "how this eval rotted unnoticed."

## Goal

Raise Windows CI from ~55% toward full coverage and make Windows-relevant tests runnable, so the class of Windows breakage that currently ships undetected is caught before release. Three components:

- **Component 1 — fix the CI exclusion regex** (+ triage what it surfaces). Deterministic fix + bounded triage loop.
- **Component 2 — Windows-safe symlink test helper**, routed through the 15 offending files, proven by making `uninstall.test.ts` green on Windows.
- **Component 3 — a proposal** (doc + workflow diff) to close the periodic-e2e coverage gap. Not merged — it carries an eval-cost decision that belongs to the upstream maintainer.

## Non-goals

- Not changing production `setup`/`_link_or_copy` (already correct) — only the tests.
- Not merging any CI-workflow change (component 3 is a proposal only).
- Not a hard tab-cap, browser-engine, or `#1882` change — those are separate specs.
- Not upstream contribution ceremony — this lands on the local `windows-fixes-and-enhancements` branch (it can be offered upstream later).
- Not fixing every test that the tightened classifier surfaces as genuinely Windows-incompatible — those get an explicit `KNOWN_WINDOWS_INCOMPATIBLE` entry with a reason, not a fix, unless the failure is a real bug.

## Component 1 — Fix the CI exclusion regex

### 1a. The fix (deterministic)

**File:** `scripts/test-free-shards.ts`. A single regex can't reliably identify a *direct* bin-spawn, because the executed path is usually a variable or a multi-arg `join(ROOT, 'bin', 'name')` — the literal `bin/name` string often isn't on the spawn line at all. So make the existing bin-path rule **conditional** instead: a test that references a bin path is Windows-fragile **only if it does not wrap its spawns in an interpreter** (`bash`/`sh`). This matches the verified reality — every spot-checked false-positive already runs `spawnSync('bash', [script])`.

Two changes:

1. Add a "safe override" pattern:
```ts
// A spawn whose FIRST arg is an interpreter runs the shebang script correctly
// on Windows (git-bash), regardless of how the script path is referenced.
const SAFE_INTERPRETER_SPAWN =
  /(?:spawnSync|spawn|execFileSync|execFile)\(\s*['"`](?:bash|sh|bun|node|npx)\b/;
```

2. In the classify function, treat the bin-path rule specially: it fires only when the bin pattern matches **and** `SAFE_INTERPRETER_SPAWN` does **not**. The bin pattern itself is kept (the existing line-74 regex, matching a `bin/` reference anywhere in the file) — it becomes the *trigger*, gated by the override:

```
isBinFragile(src) = BIN_PATH_PATTERN.test(src) && !SAFE_INTERPRETER_SPAWN.test(src)
```

- `spawnSync('bash', [join(ROOT,'bin','x')])` → bin referenced, but `SAFE_INTERPRETER_SPAWN` matches → **not fragile → stays in the Windows suite.**
- `spawnSync(SCRIPT, …)` with `const SCRIPT = join(ROOT,'bin','x')` and no bash wrap → bin referenced, no interpreter spawn → **fragile → correctly excluded.**

The exact wiring (special-casing the one rule vs. generalizing every rule to support an `unless` predicate) is finalized in the plan; the classifier unit test (below) is the correctness gate. All other `WINDOWS_FRAGILE_PATTERNS` and the `KNOWN_WINDOWS_INCOMPATIBLE` list are unchanged.

**Residual false-positive (documented, acceptable):** a file that references a bin path but neither spawns it directly nor via bash (e.g. a path constant used only in an assertion) stays excluded — no worse than today, and fail-forward (§Error handling) covers it. A file that mixes a bash-wrapped spawn with a separate direct bin-spawn would be wrongly re-included; if it fails Windows CI it gets a `KNOWN_WINDOWS_INCOMPATIBLE` entry. Both are rare and strictly better than excluding 76 files.

### 1b. Triage what it surfaces (bounded loop)

Running the tightened classifier will re-include dozens of previously-excluded tests. On Windows some may fail — each is either:
- a **real Windows bug** → fix it (that is the point of this work), or
- a **genuine incompatibility** the classifier can't detect from source → add an explicit `KNOWN_WINDOWS_INCOMPATIBLE` entry with a precise reason.

Size is unknown until run. The plan treats 1a as the shippable deliverable and 1b as a triage loop whose outcome is documented (N re-included, X real bugs fixed, Y explicitly excluded with reasons).

## Component 2 — Windows-safe symlink test helper

### The helper

**New file:** `test/helpers/link-or-copy.ts`, exporting:

```ts
export function linkOrCopySync(src: string, dst: string): void
```

Semantics mirror production `_link_or_copy` (`setup:43-64`):
- **POSIX** (`process.platform !== 'win32'`): `fs.symlinkSync(src, dst)`.
- **Windows:** resolve `src` the way a symlink would (relative to `path.dirname(dst)` when `src` is not absolute); if the resolved source exists, copy it (`fs.cpSync(resolved, dst, { recursive: true })` for dirs/files); if it does not exist, return quietly (mirrors `_link_or_copy`'s relative-source skip). Copy errors are NOT swallowed — they throw, so a broken link fails the test loudly.

### Routing + guard

- Mechanically replace every raw `fs.symlinkSync(a, b)` in the 15 files with `linkOrCopySync(a, b)`. The affected tests only assert that content exists at `dst`; a copy satisfies every such assertion.
- **Invariant guard:** add a static test (mirroring `test/setup-windows-fallback.test.ts`) asserting no file under `test/**` (excluding the helper itself) calls raw `fs.symlinkSync` — enforcing the route-through-helper rule so this can't silently regress.

## Component 3 — Periodic-e2e coverage (proposal only)

Deliverable is a doc, not a merge: `docs/superpowers/specs/2026-07-15-periodic-e2e-coverage-proposal.md` containing:
- The current gap (which `test/skill-e2e-*.test.ts` / `*-e2e.test.ts` run in `evals.yml` vs `evals-periodic.yml` vs neither).
- A proposed `evals-periodic.yml` diff replacing the hardcoded matrix with a glob (`test/skill-e2e-*.test.ts` + routing) minus a curated exclude-list of genuinely expensive/flaky suites.
- A per-file cost/runtime estimate (~$1/file/run) so the maintainer can make the budget call.

No workflow file is modified.

## Data flow / where things run

```
test-free-shards.ts  (classifier)
  -> reads each test file's source, applies WINDOWS_FRAGILE_PATTERNS + KNOWN list
  -> emits the windows-latest shard list consumed by windows-free-tests.yml

Component 1: tighten one pattern -> more tests enter the Windows shard list
Component 2: linkOrCopySync -> the install/uninstall tests actually run on Windows
```

## Error handling

- **Regex change only narrows exclusions.** Worst case: a still-incompatible test slips into the Windows shard and fails CI once → caught → added to `KNOWN_WINDOWS_INCOMPATIBLE` with a reason. Fail-forward, never silent.
- **Helper copy errors throw** (never swallowed) so a genuinely broken link surfaces as a test failure, not a false pass.
- **Invariant guard** prevents new raw `symlinkSync` usages from regressing the Windows suite.

## Testing

- **Component 1a:** a classifier unit test feeding sample source snippets: `spawnSync('bash', [binPath])` → stays IN; `spawnSync('bun', [binPath])` / `node` → stays IN; `spawnSync(SCRIPT, …)` with a bin-path `SCRIPT` and no interpreter wrap → OUT; and the documented residual — a bin-path referenced with no spawn at all → OUT (asserted so the residual is intentional, not accidental). This proves `isBinFragile` and guards the exact regression.
- **Component 1b:** run the tightened classifier against the real suite; record the surfaced list; run those on Windows; document the triage outcome.
- **Component 2:** unit-test `linkOrCopySync`'s Windows copy path (dir + file + missing-source skip) on this machine; the invariant guard; and the real proof — `test/uninstall.test.ts` goes from **4/7 failing to 7/7** on this Windows box, plus any other install tests the helper unblocks.
- **Component 3:** none (proposal artifact).

## Platform notes

- Build + verify on Windows 11 (this machine) via `bun test`. Python not involved.
- Commits land on `windows-fixes-and-enhancements` (local). Planning docs live in `docs/superpowers/` on the same branch so spec + plan + code travel together; they are local additions that will not conflict on future `git merge origin/main`.

## Open questions (resolve during planning)

- Exact count of files the tightened classifier surfaces (determines 1b size) — measured, not guessed, in the plan's first step.
- Whether any surfaced failure is a real bug worth fixing now vs deferring (case-by-case in 1b).
