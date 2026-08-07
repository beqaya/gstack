import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const GUARD = path.join(ROOT, 'bin', 'gstack-budget-guard');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-bg-')); }
function cli(args: string[], root: string) {
  const o = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return o.stdout.toString().trim();
}
function guard(root: string, runId: string | undefined) {
  const env: Record<string, string> = { ...process.env, GSTACK_STATE_ROOT: root };
  if (runId) env.GSTACK_ACTIVE_RUN = runId;
  const o = spawnSync([PY, GUARD], {
    env,
    stdin: Buffer.from(JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' },
    })),
  });
  return { code: o.exitCode, stdout: o.stdout.toString().trim() };
}

describe('gstack-budget-guard', () => {
  test('ALLOWS work while under budget', () => {
    const root = tmpRoot();
    const runId = cli(['init', '--goal', 'g', '--budget', '1000'], root);
    cli(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '10'], root);

    const out = guard(root, runId);
    expect(out.code).toBe(0);
    const d = JSON.parse(out.stdout);
    expect(d.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  test('DENIES work once the ceiling is crossed', () => {
    const root = tmpRoot();
    const runId = cli(['init', '--goal', 'g', '--budget', '100'], root);
    cli(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '500'], root);

    const out = guard(root, runId);
    const d = JSON.parse(out.stdout);
    expect(d.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(d.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(d.hookSpecificOutput.permissionDecisionReason).toContain('budget');
  });

  test('fails CLOSED when spend cannot be determined', () => {
    const root = tmpRoot();
    const runId = cli(['init', '--goal', 'g', '--budget', '100'], root);
    fs.rmSync(path.join(root, 'runs', runId, 'manifest.json'), { force: true });

    const d = JSON.parse(guard(root, runId).stdout);
    expect(d.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('is inert when no run is active', () => {
    const root = tmpRoot();
    const out = guard(root, undefined);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('');
  });
});
