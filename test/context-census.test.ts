import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const CENSUS = path.join(ROOT, 'bin', 'gstack-context-census');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function census(args: string[]) {
  const o = spawnSync([PY, CENSUS, ...args], { env: { ...process.env } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}

/** A transcript with known content, so attribution can be checked exactly. */
function transcript(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-cc-')), 't.jsonl');
  const rows = [
    { type: 'user', message: { content: 'u'.repeat(400) } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'a'.repeat(800) }] } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'c'.repeat(1200) } }] } },
    { type: 'user', message: { content: [
      { type: 'tool_result', content: 'r'.repeat(1600) }] } },
  ];
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

describe('gstack-context-census attributes tokens to consumers', () => {
  test('each consumer is reported, and they sum to the total', () => {
    const out = JSON.parse(census(['--transcript', transcript()]).stdout);
    const c = out.by_consumer;
    expect(Object.keys(c).sort()).toEqual(
      ['assistant text', 'tool calls', 'tool results', 'user text']);
    expect(Object.values<number>(c).reduce((a, b) => a + b, 0)).toBe(out.total_tokens);
  }, T);

  test('the largest consumer is identified correctly', () => {
    const out = JSON.parse(census(['--transcript', transcript()]).stdout);
    // tool_result is the longest string in the fixture at 1600 chars.
    const top = Object.entries<number>(out.by_consumer).sort((a, b) => b[1] - a[1])[0];
    expect(top[0]).toBe('tool results');
  }, T);

  test('tool traffic is broken down by tool name', () => {
    const out = JSON.parse(census(['--transcript', transcript()]).stdout);
    expect(out.by_tool.Bash).toBeGreaterThan(0);
  }, T);

  // A census computed over a partly unreadable file is wrong in a direction
  // nobody can see, so the count travels with the figure.
  test('unreadable lines are counted, not skipped silently', () => {
    const p = transcript();
    fs.appendFileSync(p, '{"type":"user","message":{"conte\n');
    const out = JSON.parse(census(['--transcript', p]).stdout);
    expect(out.unreadable_lines).toBe(1);
  }, T);
});

describe('gstack-context-census refusals', () => {
  test('a missing transcript is an error, not an empty report', () => {
    const r = census(['--transcript', path.join(os.tmpdir(), 'nope.jsonl')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no such transcript');
  }, T);

  test('a transcript with nothing attributable exits 3', () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-cc-')), 'e.jsonl');
    fs.writeFileSync(p, '\n\n');
    expect(census(['--transcript', p]).code).toBe(3);
  }, T);
});
