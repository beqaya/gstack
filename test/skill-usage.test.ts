import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const REC = path.join(ROOT, 'bin', 'gstack-skill-usage');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-su-')); }
function record(payload: string, root: string) {
  const o = spawnSync([PY, REC], {
    env: { ...process.env, GSTACK_STATE_ROOT: root }, stdin: Buffer.from(payload),
  });
  return { code: o.exitCode, stderr: o.stderr.toString().trim() };
}
function lines(root: string): any[] {
  const p = path.join(root, 'analytics', 'skill-usage.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

describe('gstack-skill-usage records every invocation', () => {
  test('a Skill invocation is recorded with name and timestamp', () => {
    const root = tmp();
    expect(record(JSON.stringify({
      tool_name: 'Skill', tool_input: { skill: 'qa' }, session_id: 'sess-1',
    }), root).code).toBe(0);
    const recs = lines(root);
    expect(recs.length).toBe(1);
    expect(recs[0].skill).toBe('qa');
    expect(recs[0].session).toBe('sess-1');
    expect(typeof recs[0].ts).toBe('string');
  }, T);

  test('repeated invocations append rather than overwrite', () => {
    const root = tmp();
    for (const s of ['qa', 'ship', 'qa']) {
      record(JSON.stringify({ tool_name: 'Skill', tool_input: { skill: s } }), root);
    }
    expect(lines(root).map(r => r.skill)).toEqual(['qa', 'ship', 'qa']);
  }, T);

  test('a non-Skill tool is ignored', () => {
    const root = tmp();
    record(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), root);
    expect(lines(root)).toEqual([]);
  }, T);
});

describe('the recorder is an observer, so it fails OPEN', () => {
  // A lost telemetry record costs one data point. A telemetry bug that blocks
  // a skill costs the user's work. This asymmetry is the whole design.
  for (const [label, payload] of [
    ['malformed JSON', 'not json at all'],
    ['empty stdin', ''],
    ['missing tool_input', '{"tool_name":"Skill"}'],
    ['null skill', '{"tool_name":"Skill","tool_input":{"skill":null}}'],
  ] as [string, string][]) {
    test(`${label} exits 0 and blocks nothing`, () => {
      const root = tmp();
      const r = record(payload, root);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
    }, T);
  }

  test('an unwritable state root still exits 0', () => {
    const r = record(JSON.stringify({
      tool_name: 'Skill', tool_input: { skill: 'qa' },
    }), path.join(tmp(), 'file-not-a-dir', 'nested'));
    expect(r.code).toBe(0);
  }, T);
});
