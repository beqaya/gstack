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
  return { code: o.exitCode, stdout: o.stdout.toString().trim() };
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
});
