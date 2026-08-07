import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-p-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run park', () => {
  test('parking one item leaves the others claimable', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const blocked = run(['add', '--run', runId, '--title', 'push to main'], root).stdout;
    run(['add', '--run', runId, '--title', 'independent work'], root);

    run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(run(['park', '--run', runId, '--item', blocked,
                '--action', 'git push origin main',
                '--reason', 'needs founder approval'], root).code).toBe(0);

    // The run continues: the other item is still claimable.
    const next = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout).title).toBe('independent work');
  });

  test('a parked item is never handed out again', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const only = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', only, '--action', 'deploy', '--reason', 'prod'], root);

    expect(run(['claim', '--run', runId, '--worker', 'w2'], root).code).toBe(4);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(1);
    expect(parked[0].action).toBe('deploy');
  });

  test('parking the same item twice is refused, so the founder sees one approval', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    expect(run(['park', '--run', runId, '--item', item,
                '--action', 'deploy', '--reason', 'prod'], root).code).toBe(0);

    const second = run(['park', '--run', runId, '--item', item,
                        '--action', 'deploy', '--reason', 'prod'], root);
    expect(second.code).toBe(8);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(1);
  });

  test('parking an already-completed item is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['done', '--run', runId, '--item', item], root);

    const late = run(['park', '--run', runId, '--item', item,
                      '--action', 'a', '--reason', 'r'], root);
    expect(late.code).toBe(8);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(0);
  });
});
