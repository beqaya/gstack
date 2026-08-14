import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const THREAD = path.join(ROOT, 'bin', 'gstack-thread');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-th-')); }

function thread(args: string[], opts: { state: string; home?: string; cwd?: string }) {
  const env: any = { ...process.env, GSTACK_STATE_ROOT: opts.state };
  if (opts.home) { env.HOME = opts.home; env.USERPROFILE = opts.home; }
  const o = spawnSync([PY, THREAD, ...args], { env, cwd: opts.cwd });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}

/** A transcript in a fake HOME, so the tool's project scan finds it. */
function writeTranscript(home: string, id: string, cwd: string, rows: any[]) {
  const dir = path.join(home, '.claude', 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const body = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), body);
  return path.join(dir, `${id}.jsonl`);
}
const humanTurn = (cwd: string, text: string) =>
  ({ type: 'user', cwd, message: { content: text } });
const toolResult = (cwd: string) =>
  ({ type: 'user', cwd, message: { content: [{ type: 'tool_result', content: 'x'.repeat(200) }] } });

describe('a session counts as real when a person typed in it', () => {
  // The bug this replaces: a file-size floor skipped any session younger than
  // a few minutes, because transcripts flush periodically. That is exactly the
  // session you just worked in — so "resume" landed on an older one.
  test('a brand-new session with one message is found, however small', () => {
    const state = tmp(), home = tmp(), work = tmp();
    thread(['--set', 'demo'], { state, cwd: work });
    writeTranscript(home, 'aaaaaaaa-0000-0000-0000-000000000001', work,
      [humanTurn(work, 'start the thing')]);

    const r = thread(['--resume', 'demo'], { state, home, cwd: work });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('aaaaaaaa-0000-0000-0000-000000000001');
  }, T);

  test('a session where nobody typed is skipped', () => {
    const state = tmp(), home = tmp(), work = tmp();
    thread(['--set', 'demo'], { state, cwd: work });
    writeTranscript(home, 'bbbbbbbb-0000-0000-0000-000000000002', work,
      [toolResult(work), { type: 'assistant', cwd: work, message: { content: [{ type: 'text', text: 'hi' }] } }]);

    const r = thread(['--resume', 'demo'], { state, home, cwd: work });
    expect(r.code).toBe(2);
  }, T);

  test('injected noise does not count as a person typing', () => {
    const state = tmp(), home = tmp(), work = tmp();
    thread(['--set', 'demo'], { state, cwd: work });
    writeTranscript(home, 'cccccccc-0000-0000-0000-000000000003', work, [
      humanTurn(work, '<system-reminder>do a thing</system-reminder>'),
      humanTurn(work, '<task-notification>done</task-notification>'),
      humanTurn(work, 'This session is being continued from a previous conversation. The summary'),
    ]);

    expect(thread(['--resume', 'demo'], { state, home, cwd: work }).code).toBe(2);
  }, T);

  test('the newest real session wins over an older real one', () => {
    const state = tmp(), home = tmp(), work = tmp();
    thread(['--set', 'demo'], { state, cwd: work });
    const older = writeTranscript(home, 'dddddddd-0000-0000-0000-000000000004', work,
      [humanTurn(work, 'older work')]);
    const newer = writeTranscript(home, 'eeeeeeee-0000-0000-0000-000000000005', work,
      [humanTurn(work, 'newer work')]);
    const past = new Date(Date.now() - 3600_000);
    fs.utimesSync(older, past, past);

    expect(thread(['--resume-id', 'demo'], { state, home, cwd: work }).stdout)
      .toBe('eeeeeeee-0000-0000-0000-000000000005');
  }, T);
});

describe('thread binding and notes', () => {
  test('a directory with no thread is refused, not guessed', () => {
    const state = tmp();
    const r = thread(['--show'], { state, cwd: tmp() });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no thread bound');
  }, T);

  test('notes are appended and survive in the thread file', () => {
    const state = tmp(), work = tmp();
    thread(['--set', 'demo'], { state, cwd: work });
    thread(['--note', 'the router shipped'], { state, cwd: work });
    expect(thread(['--show'], { state, cwd: work }).stdout).toContain('the router shipped');
  }, T);

  // Hooks must never break the thing they observe.
  test('hook modes exit 0 on malformed input', () => {
    const state = tmp();
    for (const mode of ['--compacted', '--notify']) {
      const o = spawnSync([PY, THREAD, mode], {
        env: { ...process.env, GSTACK_STATE_ROOT: state },
        stdin: Buffer.from('not json at all'),
      });
      expect(o.exitCode).toBe(0);
    }
  }, T);
});
