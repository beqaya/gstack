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

  test('a negative token record is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    const bad = run(['budget-record', '--run', runId, '--agent', 'w',
                     '--phase', 'work', '--tokens', '-500'], root);
    expect(bad.code).toBe(9);
    const b = JSON.parse(run(['budget-check', '--run', runId], root).stdout);
    expect(b.spent).toBe(0);
  });

  test('spending exactly the budget counts as exhausted', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '100'], root);
    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(6);
    expect(JSON.parse(c.stdout).exhausted).toBe(true);
  });

  test('a MISSING ledger.jsonl reports exhausted — init always creates it, so absence is anomalous', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    fs.rmSync(path.join(root, 'runs', runId, 'ledger.jsonl'), { force: true });

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(6);
    const b = JSON.parse(c.stdout);
    expect(b.exhausted).toBe(true);
  });

  test('an EMPTY ledger.jsonl is normal — spent 0, not exhausted', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(0);
    const b = JSON.parse(c.stdout);
    expect(b.spent).toBe(0);
    expect(b.exhausted).toBe(false);
  });

  test('a corrupt ledger line fails CLOSED rather than under-counting', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10000'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '5'], root);
    // Simulate a crash mid-append.
    fs.appendFileSync(path.join(root, 'runs', runId, 'ledger.jsonl'), '{"agent":"w","tok');

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(6);
    const b = JSON.parse(c.stdout);
    expect(b.exhausted).toBe(true);
    expect(b.ledger_unreadable_lines).toBe(1);
  });
});
