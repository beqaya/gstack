import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-b-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run budget', () => {
  test('spend accumulates and remaining falls', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w1', '--phase', 'work', '--tokens', '400'], root);
    run(['budget-record', '--run', runId, '--agent', 'w2', '--phase', 'verify', '--tokens', '100'], root);

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(0);
    const b = JSON.parse(c.stdout);
    expect(b.spent).toBe(500);
    expect(b.remaining).toBe(500);
    expect(b.exhausted).toBe(false);
  });

  test('crossing the ceiling reports exhausted with a distinct exit code', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w1', '--phase', 'work', '--tokens', '150'], root);

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(6);
    const b = JSON.parse(c.stdout);
    expect(b.exhausted).toBe(true);
    expect(b.remaining).toBe(0);
  });
});
