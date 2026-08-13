import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, 'bin', 'gstack-prompt-log');
const PY = process.env.GSTACK_PY || 'python';
// Each test spawns a process; Windows creation cost trips Bun's 5s default,
// which surfaces as a null exit code rather than a failure.
const T = 120000;

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-pl-')); }

function submit(payload: string, root: string) {
  const o = spawnSync([PY, LOG], {
    env: { ...process.env, GSTACK_STATE_ROOT: root }, stdin: Buffer.from(payload),
  });
  return { code: o.exitCode, stderr: o.stderr.toString().trim() };
}
function show(root: string, extra: string[] = [], cwd?: string) {
  const o = spawnSync([PY, LOG, '--show', ...extra], {
    env: { ...process.env, GSTACK_STATE_ROOT: root }, cwd,
  });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}
function entries(root: string): any[] {
  const p = path.join(root, 'prompts.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

describe('gstack-prompt-log captures the instruction, not the reply', () => {
  test('a submitted prompt is recorded with session, cwd and timestamp', () => {
    const root = tmp();
    expect(submit(JSON.stringify({
      session_id: 'sess-1', cwd: 'C:/work/thing', prompt: 'build the thing',
    }), root).code).toBe(0);

    const e = entries(root);
    expect(e.length).toBe(1);
    expect(e[0].prompt).toBe('build the thing');
    expect(e[0].session).toBe('sess-1');
    expect(e[0].cwd).toBe('C:/work/thing');
    expect(typeof e[0].ts).toBe('string');
  }, T);

  // The defect this exists for: the transcript buffers, so a crash loses the
  // tail. A log that also buffered would reproduce it exactly.
  test('the record is on disk the instant the process returns', () => {
    const root = tmp();
    submit(JSON.stringify({ session_id: 's', prompt: 'urgent instruction' }), root);
    // No sleep, no retry — read immediately after the child exits.
    const raw = fs.readFileSync(path.join(root, 'prompts.jsonl'), 'utf8');
    expect(raw).toContain('urgent instruction');
  }, T);

  test('prompts append in order rather than overwriting', () => {
    const root = tmp();
    for (const p of ['first', 'second', 'third']) {
      submit(JSON.stringify({ session_id: 's', prompt: p }), root);
    }
    expect(entries(root).map(e => e.prompt)).toEqual(['first', 'second', 'third']);
  }, T);

  test('non-ASCII prompts survive intact', () => {
    const root = tmp();
    submit(JSON.stringify({ session_id: 's', prompt: 'شغّل الأمر الآن' }), root);
    expect(entries(root)[0].prompt).toBe('شغّل الأمر الآن');
  }, T);
});

describe('it is an observer, so it fails OPEN', () => {
  // A lost log line costs one record. A logging bug that blocks a prompt costs
  // the session — which is the thing this was built to protect.
  for (const [label, payload] of [
    ['malformed JSON', 'not json at all'],
    ['empty stdin', ''],
    ['missing prompt', '{"session_id":"s"}'],
    ['null prompt', '{"session_id":"s","prompt":null}'],
    ['whitespace-only prompt', '{"session_id":"s","prompt":"   "}'],
    ['prompt is not a string', '{"session_id":"s","prompt":{"a":1}}'],
  ] as [string, string][]) {
    test(`${label} exits 0 silently and writes nothing`, () => {
      const root = tmp();
      const r = submit(payload, root);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
      expect(entries(root)).toEqual([]);
    }, T);
  }

  test('an unwritable state root still exits 0', () => {
    const blocked = path.join(tmp(), 'a-file');
    fs.writeFileSync(blocked, 'not a directory');
    const r = submit(JSON.stringify({ prompt: 'hello' }), path.join(blocked, 'nested'));
    expect(r.code).toBe(0);
  }, T);
});

describe('reading prompts back', () => {
  function seeded() {
    const root = tmp();
    submit(JSON.stringify({ session_id: 'aaa', cwd: 'C:/proj/one', prompt: 'alpha task' }), root);
    submit(JSON.stringify({ session_id: 'bbb', cwd: 'C:/proj/two', prompt: 'beta task' }), root);
    return root;
  }

  test('--session narrows to one session', () => {
    const r = show(seeded(), ['--session', 'aaa', '--all-projects']);
    expect(r.stdout).toContain('alpha task');
    expect(r.stdout).not.toContain('beta task');
  }, T);

  test('--all-projects shows every project', () => {
    const r = show(seeded(), ['--all-projects']);
    expect(r.stdout).toContain('alpha task');
    expect(r.stdout).toContain('beta task');
  }, T);

  test('with no log at all it says so rather than printing nothing', () => {
    const r = show(tmp(), ['--all-projects']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no prompt log yet');
  }, T);
});
