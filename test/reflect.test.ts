import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const COLLECT = path.join(ROOT, 'bin', 'gstack-reflect-collect');
const REFLECT = path.join(ROOT, 'bin', 'gstack-reflect');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-rf-')); }

function collect(payload: unknown, root: string) {
  const o = spawnSync([PY, COLLECT], {
    env: { ...process.env, GSTACK_STATE_ROOT: root },
    stdin: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
  });
  return { code: o.exitCode, stderr: o.stderr.toString().trim() };
}

function reflect(root: string, args: string[] = []) {
  // GSTACK_BUN_BIN is the bun running this test, which sidesteps the
  // extensionless npm `bun` shim that subprocess cannot exec on Windows.
  const o = spawnSync([PY, REFLECT, ...args], {
    env: {
      ...process.env, GSTACK_STATE_ROOT: root, GSTACK_HOME: root,
      GSTACK_BUN_BIN: process.execPath,
    },
  });
  return { code: o.exitCode, out: o.stdout.toString(), err: o.stderr.toString() };
}

function evidence(root: string): any[] {
  const p = path.join(root, 'analytics', 'reflect-evidence.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

function seedSkill(root: string, skill: string, session: string) {
  const dir = path.join(root, 'analytics');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'skill-usage.jsonl'),
    JSON.stringify({ skill, ts: new Date().toISOString(), session }) + '\n');
}

const FAILURE = {
  session_id: 'S1', tool_name: 'Bash', cwd: 'C:/repo',
  tool_input: { command: 'bun test foo.test.ts --api_key=sk-abcdefgh12345' },
  error: 'error: Executable not found in $PATH: "browse"\n  at line 42',
};

describe('gstack-reflect-collect captures what failed', () => {
  test('a failure is recorded and attributed to the session\'s skill', () => {
    const root = tmp();
    seedSkill(root, 'qa', 'S1');
    expect(collect(FAILURE, root).code).toBe(0);
    const recs = evidence(root);
    expect(recs.length).toBe(1);
    expect(recs[0].skill).toBe('qa');
    expect(recs[0].tool).toBe('Bash');
    expect(recs[0].error_key).toBe('error');
    expect(recs[0].payload_keys).toContain('tool_input');
  }, T);

  test('a secret in the recorded target is redacted', () => {
    const root = tmp();
    seedSkill(root, 'qa', 'S1');
    collect(FAILURE, root);
    const target = evidence(root)[0].target as string;
    expect(target).not.toContain('sk-abcdefgh12345');
    expect(target).toContain('[redacted]');
  }, T);

  test('an unknown session is recorded, unattributed, not dropped', () => {
    const root = tmp();
    collect({ ...FAILURE, session_id: 'nobody' }, root);
    const recs = evidence(root);
    expect(recs.length).toBe(1);
    expect(recs[0].skill).toBeNull();
  }, T);

  test('the error text is found under tool_response too', () => {
    const root = tmp();
    collect({
      session_id: 'x', tool_name: 'Edit', tool_input: { file_path: 'a.ts' },
      tool_response: 'String not found in file',
    }, root);
    expect(evidence(root)[0].error).toBe('String not found in file');
  }, T);
});

describe('the collector is an observer, so it fails OPEN', () => {
  test('malformed JSON exits 0 and records nothing', () => {
    const root = tmp();
    const r = collect('not json at all', root);
    expect(r.code).toBe(0);
    expect(evidence(root)).toEqual([]);
  }, T);

  test('an empty payload exits 0', () => {
    expect(collect('', tmp()).code).toBe(0);
  }, T);
});

describe('gstack-reflect proposes only what repeated', () => {
  test('no evidence file reports that the collector has not fired', () => {
    const r = reflect(tmp());
    expect(r.code).toBe(1);
    expect(r.out).toContain('not fired');
  }, T);

  test('a single failure is not proposed', () => {
    const root = tmp();
    seedSkill(root, 'qa', 'S1');
    collect(FAILURE, root);
    const r = reflect(root);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Nothing repeated');
  }, T);

  test('a repeated failure is proposed, and the dry run writes nothing', () => {
    const root = tmp();
    seedSkill(root, 'qa', 'S1');
    collect(FAILURE, root); collect(FAILURE, root);
    const r = reflect(root);
    expect(r.out).toContain('would propose');
    expect(r.out).toContain('/qa');
    expect(fs.existsSync(path.join(root, 'playbooks'))).toBe(false);
  }, T);

  test('--apply lands a PENDING bullet and is idempotent', () => {
    const root = tmp();
    seedSkill(root, 'qa', 'S1');
    collect(FAILURE, root); collect(FAILURE, root);

    expect(reflect(root, ['--apply']).out).toContain('[proposed]');
    const book = path.join(root, 'playbooks', 'qa.jsonl');
    expect(fs.existsSync(book)).toBe(true);
    const events = fs.readFileSync(book, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    expect(events.some((e) => e.source === 'reflect')).toBe(true);

    expect(reflect(root, ['--apply']).out).toContain('[already proposed]');
  }, T);

  test('unattributed evidence is surfaced rather than discarded', () => {
    const root = tmp();
    collect({ ...FAILURE, session_id: 'nobody' }, root);
    collect({ ...FAILURE, session_id: 'nobody' }, root);
    const r = reflect(root);
    expect(r.out).toContain('Unattributed evidence');
    expect(r.out).toContain('2 records');
  }, T);

  test('--json reports counts a caller can act on', () => {
    const root = tmp();
    seedSkill(root, 'qa', 'S1');
    collect(FAILURE, root); collect(FAILURE, root);
    const d = JSON.parse(reflect(root, ['--json']).out);
    expect(d.evidence).toBe(2);
    expect(d.attributed).toBe(2);
    expect(d.proposals[0].skill).toBe('qa');
    expect(d.proposals[0].count).toBe(2);
  }, T);
});
