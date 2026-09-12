/**
 * Gap B (v1.46.0.0): --catalog-mode=full opt-out behavior.
 *
 * The catalog trim is the default. The opt-out (`--catalog-mode=full`)
 * preserves v1.44 multi-line frontmatter descriptions for users / hosts
 * that depend on the legacy fat catalog. Without this test, someone could
 * break the conditional `if (host === 'claude' && CATALOG_MODE === 'trim')`
 * and silently turn the opt-out path into a no-op — users with the flag
 * still get trim'd output, the v1.44 behavior is gone.
 *
 * Two layers:
 *   1. Static: the CATALOG_MODE flag is wired into gen-skill-docs.ts and
 *      the conditional gate is in the pipeline.
 *   2. Smoke: running with --catalog-mode=full produces a frontmatter
 *      `description: |` block (multi-line) instead of the trim'd one-line
 *      `description: ...(gstack)` form.
 *
 * The smoke test mutates the working tree mid-run. It restores the default
 * trim'd state in a finally block so a crash mid-test still leaves a clean
 * working tree.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const GEN_SKILL_DOCS = path.join(REPO_ROOT, 'scripts', 'gen-skill-docs.ts');
const SHIP_SKILL = path.join(REPO_ROOT, 'ship', 'SKILL.md');
const PROACTIVE_SUGGESTIONS = path.join(REPO_ROOT, 'scripts', 'proactive-suggestions.json');

describe('--catalog-mode=full opt-out wiring (static)', () => {
  test('CATALOG_MODE_ARG parsing is wired into gen-skill-docs.ts', () => {
    const src = fs.readFileSync(GEN_SKILL_DOCS, 'utf-8');
    expect(src).toContain('CATALOG_MODE_ARG');
    expect(src).toContain("a.startsWith('--catalog-mode')");
  });

  test('CATALOG_MODE accepts only "trim" or "full" — anything else throws', () => {
    const src = fs.readFileSync(GEN_SKILL_DOCS, 'utf-8');
    expect(src).toMatch(/val !== 'trim' && val !== 'full'/);
    expect(src).toContain('Unknown catalog mode');
  });

  test('catalog trim only fires when CATALOG_MODE === "trim"', () => {
    const src = fs.readFileSync(GEN_SKILL_DOCS, 'utf-8');
    // The applyCatalogTrim call is gated by both host and CATALOG_MODE checks.
    expect(src).toMatch(/CATALOG_MODE === 'trim'/);
    expect(src).toContain('applyCatalogTrim(content, skillName)');
  });

  test('default CATALOG_MODE is "full" in this fork (founder decision, 2026-09-12)', () => {
    const src = fs.readFileSync(GEN_SKILL_DOCS, 'utf-8');
    // Upstream defaults to 'trim'. This fork commits the tree in full mode, and
    // a default that disagrees with the committed state means every bare
    // regeneration — including the ones tests perform — flips the tree.
    expect(src).toMatch(/if \(!CATALOG_MODE_ARG\) return 'full'/);
  });
});

describe('--catalog-mode=full opt-out behavior (smoke)', () => {
  test('--catalog-mode=full produces multi-line description in frontmatter', () => {
    // Both renders go to a scratch --out-dir, never the working tree. This
    // test used to regenerate in place and "restore full in finally" — and
    // several other suites regenerate in place too, so the mode left on disk
    // was whichever test ran last. A commit taken after a green suite then
    // shipped the other mode. That is how two plan-review skills came to be
    // unroutable on main (2026-09-12). Rendering off-tree removes the whole
    // class: nothing here can dirty a tracked file, so there is nothing to
    // restore and nothing to get wrong.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-catalog-mode-'));
    const trimDir = path.join(scratch, 'trim');
    const fullDir = path.join(scratch, 'full');
    const suggestionsBefore = fs.readFileSync(PROACTIVE_SUGGESTIONS, 'utf-8');

    try {
      // Generate trim mode explicitly (it is upstream's default, not ours), then
      // assert its shape.
      const trimRun = spawnSync('bun', ['run', 'gen:skill-docs', '--catalog-mode=trim', `--out-dir=${trimDir}`], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      expect(trimRun.status).toBe(0);
      const trimmedShip = fs.readFileSync(path.join(trimDir, 'ship', 'SKILL.md'), 'utf-8');
      // #1778: the trimmed ship description has an interior colon ("Ship workflow:")
      // and is now YAML-quoted — tolerate the optional surrounding quotes.
      expect(trimmedShip).toMatch(/^description: "?Ship workflow:[^\n]*\(gstack\)"?\n/m);

      // Run with --catalog-mode=full, also off-tree.
      const result = spawnSync(
        'bun',
        ['run', 'gen:skill-docs', '--catalog-mode=full', `--out-dir=${fullDir}`],
        { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
      );
      expect(result.status).toBe(0);

      // After --catalog-mode=full, frontmatter description is the legacy
      // multi-line block, not the trim'd one-line form.
      const fullShip = fs.readFileSync(path.join(fullDir, 'ship', 'SKILL.md'), 'utf-8');
      expect(fullShip).toMatch(/^description: \|\s*$/m); // YAML block scalar
      // Legacy multi-line content includes "Use when asked to..." in the
      // frontmatter (in trim mode this lives in the body section).
      const fmEnd = fullShip.indexOf('\n---', 4);
      const fm = fullShip.slice(0, fmEnd);
      expect(fm).toMatch(/Use when asked to/i);

      // "When to invoke" body section should NOT be present in full mode
      // (because the routing prose stayed in frontmatter).
      const body = fullShip.slice(fmEnd);
      expect(body).not.toContain('## When to invoke this skill');
      // The tracked tree must be untouched by either render. This is the
      // assertion that makes the off-tree contract load-bearing rather than
      // a convention: if the generator ever writes a tracked file in
      // --out-dir mode again, this fails here instead of in someone's commit.
      const checkedInShip = fs.readFileSync(SHIP_SKILL, 'utf-8');
      expect(checkedInShip).toMatch(/^description: \|\s*$/m);
      expect(fs.readFileSync(PROACTIVE_SUGGESTIONS, 'utf-8')).toBe(suggestionsBefore);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }, 180_000);

  test('--catalog-mode=invalid throws a clear error', () => {
    const result = spawnSync('bun', ['run', 'gen:skill-docs', '--catalog-mode=invalid'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
    const stderr = result.stderr?.toString() ?? '';
    expect(stderr).toMatch(/Unknown catalog mode/);
    expect(stderr).toMatch(/invalid/);
  });
});
