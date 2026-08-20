/**
 * gstack-run stall-skip: a unit re-claimed too many times without finishing
 * is stepped over so the convoy continues (Gastown's mechanic).
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const BIN = path.resolve(__dirname, '..', 'bin', 'gstack-run');
const T = 30000;

function run(stateRoot: string, args: string[]): { code: number; out: string; err: string } {
  const o = spawnSync(['python', BIN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: stateRoot } });
  return { code: o.exitCode ?? -1, out: o.stdout.toString().trim(), err: o.stderr.toString().trim() };
}

describe('gstack-run stall-skip', () => {
  test('an item claimed 3 times without done is auto-skipped on the 4th claim', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-skip-'));
    try {
      const rid = run(root, ['init', '--goal', 'skip-test', '--budget', '1000']).out;
      const iid = run(root, ['add', '--run', rid, '--title', 'poison']).out;
      for (const w of ['w1', 'w2', 'w3']) {
        run(root, ['claim', '--run', rid, '--worker', w]);
        run(root, ['release', '--run', rid, '--item', iid, '--worker', w]);
      }
      const fourth = run(root, ['claim', '--run', rid, '--worker', 'w4']);
      expect(fourth.err).toContain('skipped poison item');
      expect(fourth.code).toBe(4); // no claimable items remain (it was the only one)

      const report = JSON.parse(run(root, ['report', '--run', rid]).out);
      expect(report.skipped).toBe(1);
      expect(report.open).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, T);

  test('manual skip records a terminal event with the reason', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-skip-'));
    try {
      const rid = run(root, ['init', '--goal', 'skip-test', '--budget', '1000']).out;
      const iid = run(root, ['add', '--run', rid, '--title', 'manual']).out;
      const r = run(root, ['skip', '--run', rid, '--item', iid, '--reason', 'founder call']);
      expect(r.out).toContain('founder call');
      const report = JSON.parse(run(root, ['report', '--run', rid]).out);
      expect(report.skipped).toBe(1);
      expect(report.open).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, T);
});
