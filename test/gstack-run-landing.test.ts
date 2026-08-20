/**
 * gstack-run landing queue: completed units ranked for founder review,
 * machine-gate ahead of the human (the fleet-literature bottleneck).
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const BIN = path.resolve(__dirname, '..', 'bin', 'gstack-run');
const T = 30000;

function run(root: string, args: string[]) {
  const o = spawnSync(['python', BIN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: o.exitCode ?? -1, out: o.stdout.toString().trim() };
}

function completeItem(root: string, rid: string, title: string): string {
  const iid = run(root, ['add', '--run', rid, '--title', title]).out;
  run(root, ['claim', '--run', rid, '--worker', 'w1']);
  run(root, ['journal', '--run', rid, '--item', iid,
    '--claim', `implemented ${title} completely`, '--verdict', 'PROVEN',
    '--evidence', 'verified against primary sources, output shown']);
  run(root, ['done', '--run', rid, '--item', iid]);
  return iid;
}

describe('gstack-run landing queue', () => {
  test('ranks gate-pass (ready) first, ungated next, gate-fail (blocked) last', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-land-'));
    try {
      const rid = run(root, ['init', '--goal', 'land', '--budget', '5000']).out;
      const a = completeItem(root, rid, 'item-A');
      const b = completeItem(root, rid, 'item-B');
      completeItem(root, rid, 'item-C'); // ungated
      run(root, ['gate', '--run', rid, '--item', a, '--result', 'pass', '--evidence', 'gate-tier tests green']);
      run(root, ['gate', '--run', rid, '--item', b, '--result', 'fail', '--evidence', 'two tests red']);
      const rows = JSON.parse(run(root, ['landing', '--run', rid, '--json']).out).landing;
      expect(rows.map((r: any) => r.state)).toEqual(['ready', 'ungated', 'blocked']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, T);

  test('an empty run reports an empty landing queue', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-land-'));
    try {
      const rid = run(root, ['init', '--goal', 'land', '--budget', '5000']).out;
      expect(run(root, ['landing', '--run', rid]).out).toContain('empty');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, T);
});
