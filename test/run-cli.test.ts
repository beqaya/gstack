import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-run-'));
}

function run(args: string[], stateRoot: string) {
  const out = spawnSync([PY, RUN, ...args], {
    env: { ...process.env, GSTACK_STATE_ROOT: stateRoot },
  });
  return {
    code: out.exitCode,
    stdout: out.stdout.toString().trim(),
    stderr: out.stderr.toString().trim(),
  };
}

describe('gstack-run init/status', () => {
  test('init creates a run dir and status reports it back', () => {
    const root = tmpRoot();
    const init = run(['init', '--goal', 'fix the widget', '--budget', '50000'], root);
    expect(init.code).toBe(0);
    const runId = init.stdout;
    expect(runId.length).toBeGreaterThan(0);

    const dir = path.join(root, 'runs', runId);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    const st = run(['status', '--run', runId], root);
    expect(st.code).toBe(0);
    const m = JSON.parse(st.stdout);
    expect(m.schema).toBe(1);
    expect(m.goal).toBe('fix the widget');
    expect(m.budget_tokens).toBe(50000);
    expect(m.status).toBe('active');
    expect(m.run_id).toBe(runId);
    expect(m.created_at).toBeTruthy();
  });

  test('status on an unknown schema halts instead of guessing', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10'], root).stdout;
    const mf = path.join(root, 'runs', runId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
    m.schema = 99;
    fs.writeFileSync(mf, JSON.stringify(m));

    const st = run(['status', '--run', runId], root);
    expect(st.code).not.toBe(0);
    expect(st.stderr).toContain('schema');
  });
});
