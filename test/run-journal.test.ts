import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-j-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run journal', () => {
  test('verdict defaults to recorded value and history returns it', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const e = run(['journal', '--run', runId, '--item', item, '--claim', 'guard blocks edits',
                   '--verdict', 'PROVEN', '--evidence', 'edit denied by hook'], root);
    expect(e.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(1);
    expect(h[0].verdict).toBe('PROVEN');
    expect(h[0].evidence).toBe('edit denied by hook');
  });

  test('a superseding entry links back so the stale claim never stands alone', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'CSP is fixed',
                       '--verdict', 'PROVEN', '--evidence', 'header changed'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'CSP is fixed',
                        '--verdict', 'CONTRADICTED', '--evidence', 'console shows 5 blocked scripts',
                        '--supersedes', first], root).stdout;

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const older = h.find((x: any) => x.entry_id === first);
    const newer = h.find((x: any) => x.entry_id === second);
    expect(older.superseded_by).toBe(second);
    expect(newer.verdict).toBe('CONTRADICTED');
  });

  test('an invalid verdict is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                     '--verdict', 'PROBABLY', '--evidence', 'e'], root);
    expect(bad.code).not.toBe(0);
  });

  test('a --supersedes target that does not exist is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                     '--verdict', 'CONTRADICTED', '--evidence', 'e',
                     '--supersedes', 'deadbeef00'], root);
    expect(bad.code).toBe(7);
    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(0);
  });

  test('a --supersedes target belonging to a DIFFERENT item is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemA = run(['add', '--run', runId, '--title', 'a'], root).stdout;
    const itemB = run(['add', '--run', runId, '--title', 'b'], root).stdout;

    const entryA = run(['journal', '--run', runId, '--item', itemA, '--claim', 'x works',
                        '--verdict', 'PROVEN', '--evidence', 'looked right'], root).stdout;

    // Filing the correction under the wrong item must not silently orphan it.
    const wrong = run(['journal', '--run', runId, '--item', itemB, '--claim', 'x works',
                       '--verdict', 'CONTRADICTED', '--evidence', 'it does not',
                       '--supersedes', entryA], root);
    expect(wrong.code).toBe(7);

    // The original claim must not be left standing alone as PROVEN by accident.
    const h = JSON.parse(run(['history', '--run', runId, '--item', itemA], root).stdout);
    expect(h.length).toBe(1);
    expect(h[0].superseded_by).toBeUndefined();
  });

  test('two entries superseding the same claim: last wins, both links recoverable', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                       '--verdict', 'PROVEN', '--evidence', 'e1'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                        '--verdict', 'UNPROVEN', '--evidence', 'e2',
                        '--supersedes', first], root).stdout;
    const third = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                       '--verdict', 'CONTRADICTED', '--evidence', 'e3',
                       '--supersedes', first], root).stdout;

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const original = h.find((x: any) => x.entry_id === first);
    expect(original.superseded_by).toBe(third);
    // Both superseders still record what they overturned.
    expect(h.filter((x: any) => x.supersedes === first).map((x: any) => x.entry_id).sort())
      .toEqual([second, third].sort());
  });

  test('a corrupt journal line fails closed rather than showing a contradicted claim as current', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['journal', '--run', runId, '--item', item, '--claim', 'the fix works',
         '--verdict', 'PROVEN', '--evidence', 'looked right'], root);
    // Simulate a crash while appending the entry that would have overturned it.
    fs.appendFileSync(path.join(root, 'runs', runId, 'journal.jsonl'), '{"entry_id":"tru');

    const h = run(['history', '--run', runId, '--item', item], root);
    expect(h.code).toBe(12);
    expect(h.stderr).toContain('unreliable');
  });
});

describe('gstack-run journal --verifier', () => {
  test('a verifier who also claimed the item is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const self = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                      '--verdict', 'PROVEN', '--evidence', 'e',
                      '--verifier', 'worker-a'], root);
    expect(self.code).toBe(15);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(0);
  });

  test('a different verifier is accepted and recorded', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                    '--verdict', 'PROVEN', '--evidence', 'e',
                    '--verifier', 'worker-b'], root);
    expect(ok.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h[0].verifier).toBe('worker-b');
  });
});
