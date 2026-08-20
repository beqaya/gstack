/**
 * gstack-run immutable acceptance ledger: an item that declared criteria
 * cannot be closed until every criterion is verified pass (Anthropic's
 * long-horizon-harness recipe — kills silent scope-narrowing).
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
  return { code: o.exitCode ?? -1, out: o.stdout.toString().trim(), err: o.stderr.toString().trim() };
}

function setup(root: string) {
  const rid = run(root, ['init', '--goal', 'accept', '--budget', '1000']).out;
  const iid = run(root, ['add', '--run', rid, '--title', 'feat']).out;
  run(root, ['claim', '--run', rid, '--worker', 'w1']);
  run(root, ['journal', '--run', rid, '--item', iid,
    '--claim', 'implemented the feature end to end', '--verdict', 'PROVEN',
    '--evidence', 'tests green, output shown']);
  return { rid, iid };
}

describe('gstack-run acceptance ledger', () => {
  test('done is refused while any criterion is unverified (exit 18)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-acc-'));
    try {
      const { rid, iid } = setup(root);
      run(root, ['criterion', '--run', rid, '--item', iid, '--text', 'tests pass']);
      run(root, ['criterion', '--run', rid, '--item', iid, '--text', 'docs updated']);
      const d = run(root, ['done', '--run', rid, '--item', iid]);
      expect(d.code).toBe(18);
      expect(d.err).toContain('2 of 2 acceptance criteria');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, T);

  test('a failed criterion still blocks done', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-acc-'));
    try {
      const { rid, iid } = setup(root);
      const c = run(root, ['criterion', '--run', rid, '--item', iid, '--text', 'must handle empty input']).out;
      run(root, ['criterion-verify', '--run', rid, '--item', iid, '--criterion', c, '--result', 'fail', '--evidence', 'crashes on empty']);
      const d = run(root, ['done', '--run', rid, '--item', iid]);
      expect(d.code).toBe(18);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, T);

  test('done succeeds only when every criterion is verified pass', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-acc-'));
    try {
      const { rid, iid } = setup(root);
      const c1 = run(root, ['criterion', '--run', rid, '--item', iid, '--text', 'tests pass']).out;
      const c2 = run(root, ['criterion', '--run', rid, '--item', iid, '--text', 'docs updated']).out;
      run(root, ['criterion-verify', '--run', rid, '--item', iid, '--criterion', c1, '--result', 'pass', '--evidence', 'green']);
      run(root, ['criterion-verify', '--run', rid, '--item', iid, '--criterion', c2, '--result', 'pass', '--evidence', 'docs']);
      const d = run(root, ['done', '--run', rid, '--item', iid]);
      expect(d.code).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, T);

  test('an item with NO criteria is unaffected (backward compatible)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'run-acc-'));
    try {
      const { rid, iid } = setup(root);
      const d = run(root, ['done', '--run', rid, '--item', iid]);
      expect(d.code).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, T);
});
