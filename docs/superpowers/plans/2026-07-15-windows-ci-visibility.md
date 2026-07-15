# Make Windows Breakage Visible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise Windows CI from ~55% of the free suite toward full coverage by fixing an over-broad test-exclusion rule and making install/uninstall tests runnable on Windows.

**Architecture:** Component 1 makes the `bin/`-fragility rule in `scripts/test-free-shards.ts` bash-aware (a test that wraps spawns in an interpreter is Windows-safe and must not be excluded), extracted into a pure `classifyFragility(content)` for unit testing. Component 2 adds a `linkOrCopySync` test helper (symlink on POSIX, copy on Windows) mirroring production `setup:_link_or_copy`, routes the 15 raw-`symlinkSync` test files through it, and guards it with an invariant test. Component 3 is a proposal doc only.

**Tech Stack:** TypeScript, Bun (`bun test`), run on Windows 11. Repo: gstack, branch `windows-fixes-and-enhancements` (local).

## Global Constraints

- Repo `~/.claude/skills/gstack`, branch `windows-fixes-and-enhancements`. Commit there; never push; never `reset --hard`.
- Only tests + the classifier change — do NOT modify production `setup` / `_link_or_copy` (already correct).
- Do NOT modify any `.github/workflows/*.yml` — component 3 is a proposal doc only.
- The `bin/` fragility rule fires iff `BIN_PATH_PATTERN.test(src) && !SAFE_INTERPRETER_SPAWN.test(src)`.
- `SAFE_INTERPRETER_SPAWN = /(?:spawnSync|spawn|execFileSync|execFile)\(\s*['"\`](?:bash|sh|bun|node|npx)\b/`
- Helper copy errors must throw (never swallowed). Missing relative source is skipped quietly (matches `_link_or_copy`).
- Run tests with `bun test <file>` from the gstack root. The Windows-safe file list is `bun run scripts/test-free-shards.ts --windows-only --list`.
- Task order is fixed: 1 → 2 → 3 → 4 → 5 (triage in Task 4 must run after the symlink helper lands, else EPERM failures pollute it).

---

### Task 1: Make the bin/-fragility rule bash-aware (Component 1a)

**Files:**
- Modify: `scripts/test-free-shards.ts` (patterns + `detectWindowsFragility`, ~lines 53-137)
- Test: `test/test-free-shards.test.ts` (append a describe block)

**Interfaces:**
- Produces: `export function classifyFragility(content: string): { reason: string } | null`
- `detectWindowsFragility(absolutePath)` keeps its signature; now delegates to `classifyFragility`.

- [ ] **Step 1: Write the failing test** — append to `test/test-free-shards.test.ts`:

```ts
import { classifyFragility } from '../scripts/test-free-shards';

describe('classifyFragility: bin/ rule is interpreter-aware', () => {
  test('bash-wrapped bin spawn is NOT fragile', () => {
    const src = `const S = path.join(ROOT, 'bin', 'gstack-uninstall');\nspawnSync('bash', [S, '--help']);`;
    expect(classifyFragility(src)).toBeNull();
  });
  test('bun-wrapped bin spawn is NOT fragile', () => {
    const src = `spawnSync('bun', [path.join(ROOT, 'bin', 'x')]);`;
    expect(classifyFragility(src)).toBeNull();
  });
  test('direct bin spawn (no interpreter) IS fragile', () => {
    const src = `const S = path.join(ROOT, 'bin', 'x');\nspawnSync(S, ['--help']);`;
    expect(classifyFragility(src)?.reason).toContain('bin/');
  });
  test('bin path referenced with no spawn stays fragile (documented residual)', () => {
    const src = `const S = path.join(ROOT, 'bin', 'x'); expect(S).toBeTruthy();`;
    expect(classifyFragility(src)).not.toBeNull();
  });
  test('a non-bin fragile pattern still fires (regression guard)', () => {
    expect(classifyFragility(`const p = '/tmp/foo';`)?.reason).toContain('/tmp/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.claude/skills/gstack && bun test test/test-free-shards.test.ts -t "interpreter-aware"`
Expected: FAIL — `classifyFragility` is not exported yet (import error), or the bash-wrapped cases return non-null under the current unconditional bin rule.

- [ ] **Step 3: Add `SAFE_INTERPRETER_SPAWN` above the patterns array**

In `scripts/test-free-shards.ts`, immediately BEFORE `const WINDOWS_FRAGILE_PATTERNS` (line 53), insert:

```ts
// A spawn whose FIRST argument is an interpreter runs a shebang script
// correctly on Windows (git-bash), regardless of how the script path is
// referenced. When present, it neutralises the bin/-reference rule below.
const SAFE_INTERPRETER_SPAWN =
  /(?:spawnSync|spawn|execFileSync|execFile)\(\s*['"`](?:bash|sh|bun|node|npx)\b/;
```

- [ ] **Step 4: Add `unless?` to the pattern type and set it on the bin rule**

Change the array type declaration:

```ts
const WINDOWS_FRAGILE_PATTERNS: Array<{ pattern: RegExp; reason: string; unless?: RegExp }> = [
```

On the bin/ entry (currently at line 74), add the `unless` field (keep the existing pattern and reason exactly):

```ts
  {
    pattern: /,\s*['"]bin['"]\s*[,)]|['"]\.?\/?bin\/[a-z][\w-]+['"]/,
    reason: 'spawns bin/ shebang script (Windows CreateProcess does not parse shebangs)',
    unless: SAFE_INTERPRETER_SPAWN,
  },
```

- [ ] **Step 5: Extract `classifyFragility` and delegate**

Replace the existing `detectWindowsFragility` function (lines ~127-137) with:

```ts
export function classifyFragility(content: string): { reason: string } | null {
  for (const { pattern, reason, unless } of WINDOWS_FRAGILE_PATTERNS) {
    if (pattern.test(content) && !(unless && unless.test(content))) {
      return { reason };
    }
  }
  return null;
}

export function detectWindowsFragility(absolutePath: string): { reason: string } | null {
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return null;
  }
  return classifyFragility(content);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd ~/.claude/skills/gstack && bun test test/test-free-shards.test.ts`
Expected: PASS (existing tests + the 5 new ones).

- [ ] **Step 7: Commit**

```bash
cd ~/.claude/skills/gstack
git add scripts/test-free-shards.ts test/test-free-shards.test.ts
git commit -m "fix(test-shards): make bin/-fragility rule interpreter-aware so bash-wrapped tests run on Windows CI"
```

---

### Task 2: `linkOrCopySync` test helper (Component 2, part 1)

**Files:**
- Create: `test/helpers/link-or-copy.ts`
- Test: `test/helpers/link-or-copy.test.ts`

**Interfaces:**
- Produces: `export function linkOrCopySync(src: string, dst: string): void` — POSIX: `fs.symlinkSync(src, dst)`. Windows: resolve `src` against `dirname(dst)` when relative; if it exists, `rmSync(dst)` then `cpSync(resolvedSrc, dst, {recursive:true})`; if missing, return quietly. Copy errors throw.

- [ ] **Step 1: Write the failing test** — `test/helpers/link-or-copy.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { linkOrCopySync } from './link-or-copy';

describe('linkOrCopySync', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('dst resolves to src content (directory source)', () => {
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'f.txt'), 'hello');
    const dst = path.join(tmp, 'dst');
    linkOrCopySync(srcDir, dst);
    expect(fs.readFileSync(path.join(dst, 'f.txt'), 'utf-8')).toBe('hello');
  });

  test('relative src resolves against dirname(dst)', () => {
    fs.mkdirSync(path.join(tmp, 'a'));
    fs.writeFileSync(path.join(tmp, 'a', 'g.txt'), 'hi');
    const dst = path.join(tmp, 'b'); // sibling of 'a'
    linkOrCopySync('a', dst);        // relative to dirname(dst) === tmp
    expect(fs.readFileSync(path.join(dst, 'g.txt'), 'utf-8')).toBe('hi');
  });

  test('Windows: missing source is skipped quietly', () => {
    if (process.platform !== 'win32') return; // POSIX intentionally makes a dangling symlink
    const dst = path.join(tmp, 'dst');
    linkOrCopySync(path.join(tmp, 'nope'), dst);
    expect(fs.existsSync(dst)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.claude/skills/gstack && bun test test/helpers/link-or-copy.test.ts`
Expected: FAIL — module `./link-or-copy` does not exist.

- [ ] **Step 3: Implement the helper** — `test/helpers/link-or-copy.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test-only mirror of setup's `_link_or_copy`: symlink on POSIX, copy on
 * Windows (where symlinkSync EPERMs without Developer Mode). `src` is resolved
 * the way a symlink would be — relative to dirname(dst) when not absolute. A
 * missing resolved source is skipped quietly (matches _link_or_copy). Copy
 * errors are NOT swallowed.
 */
export function linkOrCopySync(src: string, dst: string): void {
  if (process.platform !== 'win32') {
    fs.symlinkSync(src, dst);
    return;
  }
  const resolvedSrc = path.isAbsolute(src) ? src : path.resolve(path.dirname(dst), src);
  if (!fs.existsSync(resolvedSrc)) return;
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(resolvedSrc, dst, { recursive: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/.claude/skills/gstack && bun test test/helpers/link-or-copy.test.ts`
Expected: PASS (3 tests; the Windows-skip test is a no-op on non-Windows CI).

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/skills/gstack
git add test/helpers/link-or-copy.ts test/helpers/link-or-copy.test.ts
git commit -m "test(helpers): add linkOrCopySync (symlink on POSIX, copy on Windows) mirroring setup _link_or_copy"
```

---

### Task 3: Route the 15 files + invariant guard + prove uninstall green (Component 2, part 2)

**Files:**
- Modify (route `fs.symlinkSync` → `linkOrCopySync`, add import): the 15 files below.
- Create: `test/no-raw-symlink-invariant.test.ts`

The 15 files (import path to the helper differs by location):
- `test/` (import `'./helpers/link-or-copy'`): `gbrain-guards.test.ts`, `gstack-upgrade-migration-v1_40_0_0.test.ts`, `helpers/e2e-helpers.ts` (import `'./link-or-copy'`), `migration-checkpoint-ownership.test.ts`, `regression-1611-gbrain-sync-resume.test.ts`, `relink.test.ts`, `security-dashboard-fallback.test.ts`, `setup-conductor-worktree.test.ts`, `skill-e2e.test.ts`, `team-mode.test.ts`, `uninstall.test.ts`
- `browse/test/` (import `'../../test/helpers/link-or-copy'`): `browser-skill-write.test.ts`, `gstack-update-check.test.ts`, `path-validation.test.ts`, `security-audit-r2.test.ts`

**Interfaces:**
- Consumes: `linkOrCopySync` from Task 2.

- [ ] **Step 1: Write the failing invariant test** — `test/no-raw-symlink-invariant.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const HELPER = path.join(ROOT, 'test', 'helpers', 'link-or-copy.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); }
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no raw fs.symlinkSync in tests (route through linkOrCopySync)', () => {
  test('every test file uses the helper, not raw symlinkSync', () => {
    const files = [
      ...walk(path.join(ROOT, 'test')),
      ...walk(path.join(ROOT, 'browse', 'test')),
    ].filter((f) => path.resolve(f) !== path.resolve(HELPER));

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      // Ignore comment lines; flag any `symlinkSync(` call.
      const hit = src.split('\n').some((line) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return false;
        return /\bsymlinkSync\s*\(/.test(line);
      });
      if (hit) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.claude/skills/gstack && bun test test/no-raw-symlink-invariant.test.ts`
Expected: FAIL — the 15 files are listed as offenders.

- [ ] **Step 3: Route each file through the helper**

For each of the 15 files: add the import (correct relative path per the list above) near the other imports, and replace every `fs.symlinkSync(A, B)` with `linkOrCopySync(A, B)`. Example for `test/uninstall.test.ts` — add after the `fs` import:

```ts
import { linkOrCopySync } from './helpers/link-or-copy';
```

and change lines 49-50 from:

```ts
      fs.symlinkSync('gstack/review', path.join(mockHome, '.claude', 'skills', 'review'));
      fs.symlinkSync('gstack/ship', path.join(mockHome, '.claude', 'skills', 'gstack-ship'));
```

to:

```ts
      linkOrCopySync('gstack/review', path.join(mockHome, '.claude', 'skills', 'review'));
      linkOrCopySync('gstack/ship', path.join(mockHome, '.claude', 'skills', 'gstack-ship'));
```

Repeat the same mechanical edit (import + call replacement) in the other 14 files. Do NOT change any other logic.

- [ ] **Step 4: Run the invariant test to verify it passes**

Run: `cd ~/.claude/skills/gstack && bun test test/no-raw-symlink-invariant.test.ts`
Expected: PASS (offenders is empty).

- [ ] **Step 5: Prove the previously-broken test now passes on Windows**

Run: `cd ~/.claude/skills/gstack && bun test test/uninstall.test.ts`
Expected: PASS 7/7 (was 3 pass / 4 fail with `EPERM: operation not permitted, symlink`).

Also spot-check two more of the routed files run clean:
Run: `bun test test/relink.test.ts test/team-mode.test.ts`
Expected: PASS (or, if a non-symlink Windows issue surfaces, note it for Task 4 — do not fix unrelated failures here).

- [ ] **Step 6: Commit**

```bash
cd ~/.claude/skills/gstack
git add test/uninstall.test.ts test/relink.test.ts test/team-mode.test.ts test/gbrain-guards.test.ts \
  test/gstack-upgrade-migration-v1_40_0_0.test.ts test/helpers/e2e-helpers.ts \
  test/migration-checkpoint-ownership.test.ts test/regression-1611-gbrain-sync-resume.test.ts \
  test/security-dashboard-fallback.test.ts test/setup-conductor-worktree.test.ts test/skill-e2e.test.ts \
  browse/test/browser-skill-write.test.ts browse/test/gstack-update-check.test.ts \
  browse/test/path-validation.test.ts browse/test/security-audit-r2.test.ts \
  test/no-raw-symlink-invariant.test.ts
git commit -m "test: route raw symlinkSync through linkOrCopySync so install/uninstall tests run on Windows (+ invariant guard)"
```

---

### Task 4: Triage the newly-surfaced tests (Component 1b)

This task has an unknown size by design: Task 1 re-includes previously-excluded tests; some may fail on Windows. Completion criterion: **the Windows-safe suite is green — every surfaced test either passes on Windows or has an explicit `KNOWN_WINDOWS_INCOMPATIBLE` entry with a reason.**

**Files:**
- Possibly modify: `scripts/test-free-shards.ts` (`KNOWN_WINDOWS_INCOMPATIBLE` list) and/or individual surfaced test files (real-bug fixes).

- [ ] **Step 1: Enumerate the surfaced Windows-safe suite**

Run: `cd ~/.claude/skills/gstack && bun run scripts/test-free-shards.ts --windows-only --list`
Record the file list (it is larger than before Task 1).

- [ ] **Step 2: Run the full surfaced suite on this Windows machine**

Run: `cd ~/.claude/skills/gstack && bun test $(bun run scripts/test-free-shards.ts --windows-only --list)`
(If the shell can't expand the list inline, save it to a file and pass with `bun test $(cat list.txt)`.)
Record which files FAIL.

- [ ] **Step 3: For each failing file, classify and resolve**

For each failing file, read the failure:
- **Real Windows bug** (the code under test is wrong on Windows) → fix it via a normal TDD cycle (failing assertion → fix → pass → commit per file). Note it in the ledger.
- **Genuine incompatibility** the classifier can't detect from source (e.g. needs Chromium, needs a POSIX-only runtime facility) → add an explicit entry to `KNOWN_WINDOWS_INCOMPATIBLE` in `scripts/test-free-shards.ts`:

```ts
  {
    file: 'test/<surfaced-file>.test.ts',
    reason: '<precise, specific reason it cannot run on windows-latest>',
  },
```

- [ ] **Step 4: Re-run until green**

Run: `cd ~/.claude/skills/gstack && bun test $(bun run scripts/test-free-shards.ts --windows-only --list)`
Expected: all pass. Re-run the classifier unit test too: `bun test test/test-free-shards.test.ts`.

- [ ] **Step 5: Commit (one commit summarizing the triage outcome)**

```bash
cd ~/.claude/skills/gstack
git add scripts/test-free-shards.ts <any-fixed-test-files>
git commit -m "test(windows): triage newly-surfaced tests — N green, X real bugs fixed, Y explicitly excluded with reasons"
```

Record the final N / X / Y in the commit body and the progress ledger.

---

### Task 5: Periodic-e2e coverage proposal (Component 3, proposal only)

**Files:**
- Create: `docs/superpowers/specs/2026-07-15-periodic-e2e-coverage-proposal.md`

No workflow file is modified.

- [ ] **Step 1: Gather the real coverage data**

Run and record:
```bash
cd ~/.claude/skills/gstack
ls test/skill-e2e-*.test.ts test/*-e2e.test.ts 2>/dev/null            # all e2e files
grep -n "file: test/" .github/workflows/evals.yml                      # gate coverage
grep -n "file: test/" .github/workflows/evals-periodic.yml             # periodic coverage
```

- [ ] **Step 2: Write the proposal doc**

Create `docs/superpowers/specs/2026-07-15-periodic-e2e-coverage-proposal.md` containing:
- **Gap table:** each e2e file × {in evals.yml? in evals-periodic.yml? in neither?} using the Step-1 data.
- **Proposed change:** replace the hardcoded `matrix.suite` list in `evals-periodic.yml` with a glob over `test/skill-e2e-*.test.ts` (+ `*-e2e.test.ts`) minus a named exclude-list of genuinely expensive/flaky suites — shown as a concrete YAML diff (in a fenced block, NOT applied to the workflow file).
- **Cost note:** ~$1/file/run; N files → ~$N/periodic-run; state the runtime/budget tradeoff so the maintainer can decide.
- **Why it's a proposal:** the cost/infra decision is the upstream maintainer's; this repo change would conflict with their CI budget on the next `git merge origin/main`.

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/skills/gstack
git add docs/superpowers/specs/2026-07-15-periodic-e2e-coverage-proposal.md
git commit -m "docs: proposal to close the periodic-e2e coverage gap (glob + exclude-list + cost estimate)"
```

---

## Notes for the executor

- Tasks 1–3 and 5 are deterministic. Task 4 is a triage loop whose size is only known after Step 1–2; treat "Windows suite green (pass or KNOWN-with-reason)" as its done-condition.
- If Task 3 Step 5's spot-checks surface a NON-symlink Windows failure, do not fix it in Task 3 — record it and handle it in Task 4 (keeps the symlink change reviewable in isolation).
- Everything is local to `windows-fixes-and-enhancements`; do not push.
