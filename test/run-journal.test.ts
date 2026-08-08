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
                   '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    expect(e.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(1);
    expect(h[0].verdict).toBe('PROVEN');
    expect(h[0].evidence).toBe('ran the command and observed the documented exit code and output');
  });

  test('a superseding entry links back so the stale claim never stands alone', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
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
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                     '--verdict', 'PROBABLY', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    expect(bad.code).not.toBe(0);
  });

  test('a --supersedes target that does not exist is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                     '--verdict', 'CONTRADICTED', '--evidence', 'ran the command and observed the documented exit code and output',
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

    const entryA = run(['journal', '--run', runId, '--item', itemA, '--claim', 'the change under test behaves as specified',
                        '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root).stdout;

    // Filing the correction under the wrong item must not silently orphan it.
    const wrong = run(['journal', '--run', runId, '--item', itemB, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'CONTRADICTED', '--evidence', 'ran the command and observed the documented exit code and output',
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
    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                        '--verdict', 'UNPROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                        '--supersedes', first], root).stdout;
    const third = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                       '--verdict', 'CONTRADICTED', '--evidence', 'ran the command and observed the documented exit code and output',
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
    run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
         '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root);
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

    const self = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                      '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
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

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                    '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                    '--verifier', 'worker-b'], root);
    expect(ok.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h[0].verifier).toBe('worker-b');
  });
});

describe('gstack-run journal --tier elevated', () => {
  test('elevated work without a verifier is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const bare = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                      '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                      '--tier', 'elevated'], root);
    expect(bare.code).toBe(16);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(0);
  });

  test('elevated work WITH a different verifier is accepted and records the tier', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                    '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                    '--tier', 'elevated', '--verifier', 'worker-b'], root);
    expect(ok.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h[0].tier).toBe('elevated');
    expect(h[0].verifier).toBe('worker-b');
  });

  test('routine work still needs no verifier', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'worker-a'], root);

    const ok = run(['journal', '--run', runId, '--item', item, '--claim', 'the change under test behaves as specified',
                    '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output',
                    '--tier', 'routine'], root);
    expect(ok.code).toBe(0);
  });
});

describe('a journal entry must actually say something', () => {
  function ready(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    return { runId, item };
  }

  test('placeholder claim and evidence are refused', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const junk = run(['journal', '--run', runId, '--item', item,
                      '--claim', 'x', '--verdict', 'PROVEN', '--evidence', 'x'], root);
    expect(junk.code).toBe(22);
    expect(JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout).length).toBe(0);
  });

  test('a placeholder verifier is refused even though it differs from the worker', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const junk = run(['journal', '--run', runId, '--item', item,
                      '--claim', 'the guard now blocks edits to generated files',
                      '--verdict', 'PROVEN',
                      '--evidence', 'ran a live Edit and the hook denied it, file bytes unchanged',
                      '--verifier', 'pending'], root);
    expect(junk.code).toBe(22);
  });

  test('substantive claim, evidence and verifier are accepted', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    const ok = run(['journal', '--run', runId, '--item', item,
                    '--claim', 'the guard now blocks edits to generated files',
                    '--verdict', 'PROVEN',
                    '--evidence', 'ran a live Edit and the hook denied it, file bytes unchanged',
                    '--verifier', 'verifier-a4cc293e'], root);
    expect(ok.code).toBe(0);
  });
});
