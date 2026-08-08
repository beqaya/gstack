import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-a-')); }
function run(args: string[], root: string) {
  const o = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return {
    code: o.exitCode,
    stdout: o.stdout.toString().trim(),
    stderr: o.stderr.toString().trim(),
  };
}

describe('acceptance: a false claim of success cannot survive', () => {
  test('a worker reporting success it did not achieve is contradicted, and the report does not count it as complete', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'ship the fix', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'make the guard block edits'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'lying-worker'], root);

    // The worker claims success without doing the work.
    const claimEntry = run(['journal', '--run', runId, '--item', item,
      '--claim', 'the guard now blocks edits to generated files',
      '--verdict', 'PROVEN', '--evidence', 'I am confident it works'], root).stdout;

    // An independent verifier re-derives from a primary source and disagrees.
    run(['journal', '--run', runId, '--item', item,
      '--claim', 'the guard now blocks edits to generated files',
      '--verdict', 'CONTRADICTED',
      '--evidence', 'live Edit on a generated file succeeded; file bytes changed on disk',
      '--supersedes', claimEntry], root);

    const history = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const original = history.find((h: any) => h.entry_id === claimEntry);

    // The false claim never stands alone.
    expect(original.superseded_by).toBeTruthy();
    expect(history.some((h: any) => h.verdict === 'CONTRADICTED')).toBe(true);

    // And it is parked for a human rather than silently reported done.
    run(['park', '--run', runId, '--item', item,
      '--action', 'make the guard block edits',
      '--reason', 'verification returned CONTRADICTED'], root);
    run(['stop', '--run', runId, '--why', 'queue-drained'], root);

    const report = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(report.completed).toBe(0);
    expect(report.parked).toBe(1);
  });

  test('a CONTRADICTED item cannot be marked done, only parked', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'make the guard block edits'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'lying-worker'], root);

    const claimEntry = run(['journal', '--run', runId, '--item', item,
      '--claim', 'the guard now blocks edits', '--verdict', 'PROVEN',
      '--evidence', 'I am confident it works'], root).stdout;
    run(['journal', '--run', runId, '--item', item,
      '--claim', 'the guard now blocks edits', '--verdict', 'CONTRADICTED',
      '--evidence', 'live edit succeeded; file bytes changed on disk',
      '--supersedes', claimEntry], root);

    // The worker tries to close it out as finished anyway.
    const sneaky = run(['done', '--run', runId, '--item', item], root);
    expect(sneaky.code).toBe(13);

    run(['stop', '--run', runId, '--why', 'queue-drained'], root);
    const report = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(report.completed).toBe(0);
  });

  test('a retry that succeeds CAN be marked done', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'fix it properly'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
      '--verdict', 'CONTRADICTED', '--evidence', 'did not work'], root).stdout;
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
      '--verdict', 'PROVEN', '--evidence', 'reran the command, output correct',
      '--supersedes', first], root);

    expect(run(['done', '--run', runId, '--item', item], root).code).toBe(0);
  });

  test('done refuses an item with no journal entry at all', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    const d = run(['done', '--run', runId, '--item', item], root);
    expect(d.code).toBe(14);
  });

  test('done refuses an item id that was never added', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;

    const d = run(['done', '--run', runId, '--item', 'nonexistent'], root);
    expect(d.code).toBe(14);
  });

  test('done refuses an item whose latest verdict is UNPROVEN', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'UNPROVEN', '--evidence', 'no evidence shown yet'], root);

    const d = run(['done', '--run', runId, '--item', item], root);
    expect(d.code).toBe(13);
  });

  test('done is allowed after a PROVEN verdict', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'PROVEN', '--evidence', 'e'], root);

    const d = run(['done', '--run', runId, '--item', item], root);
    expect(d.code).toBe(0);
  });

  test('a corrupt journal line blocks done rather than letting falsified work through', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'PROVEN', '--evidence', 'e'], root);
    // Simulate a crash while appending the entry that would have contradicted it.
    fs.appendFileSync(path.join(root, 'runs', runId, 'journal.jsonl'), '{"verdict":"CONTRA');

    const d = run(['done', '--run', runId, '--item', item], root);
    expect(d.code).toBe(12);

    run(['stop', '--run', runId, '--why', 'queue-drained'], root);
    expect(JSON.parse(run(['report', '--run', runId], root).stdout).completed).toBe(0);
  });
});

describe('tier derived from touched paths, not from prose', () => {
  function ready(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    return { runId, item };
  }

  test('touching enforcement code while claiming routine is refused', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'PROVEN', '--evidence', 'e', '--tier', 'routine'], root);

    const sneaky = run(['done', '--run', runId, '--item', item,
                        '--touched', 'bin/example-tool'], root);
    expect(sneaky.code).toBe(19);
    expect(sneaky.stderr).toContain('not from what was claimed');
  });

  test('touching enforcement code with elevated + verifier is allowed', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'PROVEN', '--evidence', 'e',
         '--tier', 'elevated', '--verifier', 'w2'], root);

    expect(run(['done', '--run', runId, '--item', item,
                '--touched', 'bin/example-tool'], root).code).toBe(0);
  });

  test('ordinary files are unaffected — routine still closes', () => {
    const root = tmpRoot();
    const { runId, item } = ready(root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'PROVEN', '--evidence', 'e', '--tier', 'routine'], root);

    expect(run(['done', '--run', runId, '--item', item,
                '--touched', 'docs/notes.md'], root).code).toBe(0);
  });
});
