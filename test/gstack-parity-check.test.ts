/**
 * bin/gstack-parity-check — the unit of parity is SKILL.md PLUS sections/.
 *
 * Carved skills tell the model to "Read sections/<name>.md" next to the live
 * SKILL.md. A checker that hashes only SKILL.md reports IDENTICAL while the
 * live copy points at a directory that is missing or stale (observed
 * 2026-09-13: 20 freshly carved skills, 56 IDENTICAL, 0 live sections/).
 *
 * Runs against a temp repo + temp live tree through the GSTACK_REPO /
 * GSTACK_LIVE_SKILLS overrides the script already honours; never touches
 * ~/.claude/skills.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(import.meta.dir, '..');
const SCRIPT = path.join(ROOT, 'bin', 'gstack-parity-check');
const PY = process.env.GSTACK_PY || 'python';

let repo: string;
let live: string;

function git(args: string[]) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

function run(args: string[] = []) {
  const r = spawnSync(PY, [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, GSTACK_REPO: repo, GSTACK_LIVE_SKILLS: live },
  });
  // Python on Windows prints CRLF; normalise so the regexes below stay portable.
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\r\n/g, '\n') };
}

let clock = Date.now() / 1000 - 3600;
/** Write with a strictly increasing mtime so "which side is newer" is deterministic. */
function write(p: string, body: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  clock += 2;
  fs.utimesSync(p, clock, clock);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-parity-repo-'));
  live = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-parity-live-'));
  // Live copies first (so the repo written below is the newer side): both
  // SKILL.md present and identical, but carved has NO sections/.
  write(path.join(live, 'plain', 'SKILL.md'), '# plain\n');
  write(path.join(live, 'carved', 'SKILL.md'), '# carved\nRead `sections/a.md`\n');
  // Two repo skills: `plain` (SKILL.md only) and `carved` (SKILL.md + sections/).
  write(path.join(repo, 'plain', 'SKILL.md'), '# plain\n');
  write(path.join(repo, 'carved', 'SKILL.md'), '# carved\nRead `sections/a.md`\n');
  write(path.join(repo, 'carved', 'sections', 'a.md'), 'section a v1\n');
  write(path.join(repo, 'carved', 'sections', 'manifest.json'), '{"sections":["a"]}\n');
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 'T']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'seed']);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(live, { recursive: true, force: true });
});

describe('gstack-parity-check: sections/ are part of the unit', () => {
  test('a live skill missing its sections/ dir is DRIFTED, not IDENTICAL', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('IDENTICAL: 1');
    expect(out).toContain('DRIFTED: 1');
    expect(out).toMatch(/carved -- repo is newer \(sections\)/);
  });

  test('--sync mirrors sections/ into the live skill and re-verifies', () => {
    const { code, out } = run(['--sync']);
    expect(code).toBe(0);
    expect(out).toContain('copied carved (+sections)');
    expect(out).toMatch(/--- post-sync ---\nIDENTICAL: 2\nDRIFTED: 0/);
    expect(fs.readFileSync(path.join(live, 'carved', 'sections', 'a.md'), 'utf-8')).toBe('section a v1\n');
    expect(fs.existsSync(path.join(live, 'carved', 'sections', 'manifest.json'))).toBe(true);
  });

  test('a stale live section file drifts even when SKILL.md matches', () => {
    run(['--sync']);
    write(path.join(live, 'carved', 'sections', 'a.md'), 'section a STALE\n');
    const { out } = run();
    expect(out).toContain('DRIFTED: 1');
    expect(out).toMatch(/carved -- live is newer \(sections\)/);
  });

  test('a live section file the repo no longer ships is removed on sync', () => {
    run(['--sync']);
    write(path.join(live, 'carved', 'sections', 'orphan.md'), 'gone upstream\n');
    const { out } = run(['--sync']);
    expect(out).toMatch(/--- post-sync ---\nIDENTICAL: 2\nDRIFTED: 0/);
    expect(fs.existsSync(path.join(live, 'carved', 'sections', 'orphan.md'))).toBe(false);
  });

  test('--sync refuses when a repo section file is uncommitted', () => {
    write(path.join(repo, 'carved', 'sections', 'a.md'), 'section a v2 (uncommitted)\n');
    const { code, out } = run(['--sync']);
    expect(code).toBe(1);
    expect(out).toContain('SYNC REFUSED');
    expect(out).toContain('carved/sections/a.md');
    expect(fs.existsSync(path.join(live, 'carved', 'sections'))).toBe(false);
  });

  test('--hook names the drifted part and always exits 0', () => {
    const { code, out } = run(['--hook']);
    expect(code).toBe(0);
    expect(out).toContain('carved (repo is newer, sections)');
    expect(out).toContain('run: gstack-parity-check --sync');
  });

  test('--hook is silent when SKILL.md and sections/ both match', () => {
    run(['--sync']);
    const { code, out } = run(['--hook']);
    expect(code).toBe(0);
    expect(out.trim()).toBe('');
  });
});
