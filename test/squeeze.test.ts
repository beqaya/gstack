import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const SQUEEZE = path.join(ROOT, 'bin', 'gstack-squeeze');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-sq-')); }

function hook(root: string, stdout: string, opts: { tool?: string; command?: string; stderr?: string } = {}) {
  const o = spawnSync([PY, SQUEEZE, '--hook'], {
    env: { ...process.env, GSTACK_STATE_ROOT: root, BASH_MAX_OUTPUT_LENGTH: '30000' },
    stdin: Buffer.from(JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: opts.tool ?? 'Bash',
      tool_input: { command: opts.command ?? 'pnpm test' },
      tool_response: { stdout, stderr: opts.stderr ?? '', interrupted: false, isImage: false },
    })),
  });
  const text = o.stdout.toString().trim();
  return { code: o.exitCode, out: text ? JSON.parse(text).hookSpecificOutput : null };
}

function log(n: number, middle: string[] = []): string {
  const lines = Array.from({ length: n }, (_, i) => `test case ${i} ... ok`);
  lines.splice(Math.floor(n / 2), 0, ...middle);
  return lines.join('\n');
}

describe('gstack-squeeze', () => {
  test('passes small output through untouched', () => {
    const r = hook(tmpRoot(), log(20));
    expect(r.code).toBe(0);
    expect(r.out).toBeNull();
  });

  test('keeps head, tail and mid-log errors, saves the full stream', () => {
    const root = tmpRoot();
    const full = log(600, ['Traceback (most recent call last):', 'AssertionError: expected 2 got 3']);
    const r = hook(root, full);
    const short: string = r.out.updatedToolOutput.stdout;
    expect(short.length).toBeLessThan(full.length / 3);
    expect(short).toContain('test case 0 ... ok');
    expect(short).toContain('test case 599 ... ok');
    expect(short).toContain('AssertionError: expected 2 got 3');
    expect(short).toMatch(/lines omitted/);
    const saved = short.match(/Full output: (\S+)/)![1];
    expect(fs.readFileSync(saved, 'utf-8')).toBe(full);
    expect(r.out.updatedToolOutput.interrupted).toBe(false);
  });

  test('collapses repeated lines', () => {
    const r = hook(tmpRoot(), Array(400).fill('npm WARN deprecated foo@1.0.0').join('\n'));
    expect(r.out.updatedToolOutput.stdout).toContain('[repeated x400]');
  });

  test('leaves output at the native cap to Claude Code', () => {
    const r = hook(tmpRoot(), 'x'.repeat(30000));
    expect(r.out).toBeNull();
  });

  test('skips deliberate reads and re-reads of saved logs', () => {
    const root = tmpRoot();
    const big = log(600);
    for (const command of ['cat big.log', "sed -n '1,500p' f", 'git diff HEAD~1',
      'Get-Content x.txt', 'head -n 400 ~/.gstack/squeeze/a.log', 'pnpm test # nosqueeze']) {
      expect(hook(root, big, { command }).out).toBeNull();
    }
  });

  test('ignores tools other than Bash and PowerShell, honours the off switch', () => {
    const root = tmpRoot();
    expect(hook(root, log(600), { tool: 'Read' }).out).toBeNull();
    expect(hook(root, log(600), { tool: 'PowerShell' }).out).not.toBeNull();
    fs.writeFileSync(path.join(root, 'squeeze.off'), '');
    expect(hook(root, log(600)).out).toBeNull();
  });

  test('skips reads inside compound commands', () => {
    const root = tmpRoot();
    for (const command of ['cd foo && cat big.txt', 'cd foo; Get-Content x', 'pnpm build | tail -n 600',
      'git --no-pager diff', 'git -C x diff']) {
      expect(hook(root, log(600), { command }).out).toBeNull();
    }
    expect(hook(root, log(600), { command: 'pnpm test src/concat.test.ts' }).out).not.toBeNull();
  });

  test('never returns something no shorter than the original, and writes no log then', () => {
    const root = tmpRoot();
    expect(hook(root, Array.from({ length: 200 }, (_, i) => `error ${i}`).join('\n')).out).toBeNull();
    expect(hook(root, Array(30).fill('dup').join('\n')).out).toBeNull();
    expect(fs.existsSync(path.join(root, 'squeeze'))).toBe(false);
  });

  test('marks cut long lines and passes images through', () => {
    const root = tmpRoot();
    const r = hook(root, 'x'.repeat(20000));
    expect(r.out.updatedToolOutput.stdout).toContain('[line cut, 20000 chars total]');
    const o = spawnSync([PY, SQUEEZE, '--hook'], {
      env: { ...process.env, GSTACK_STATE_ROOT: root },
      stdin: Buffer.from(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' },
        tool_response: { stdout: 'data:image/png;base64,' + 'A'.repeat(20000), stderr: '', interrupted: false, isImage: true } })),
    });
    expect(o.stdout.toString().trim()).toBe('');
  });

  test('records savings for --stats', () => {
    const root = tmpRoot();
    hook(root, log(600));
    const o = spawnSync([PY, SQUEEZE, '--stats'], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
    expect(o.stdout.toString()).toContain('squeezed outputs: 1');
  });
});
