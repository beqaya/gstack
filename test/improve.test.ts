import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const IMPROVE = path.join(ROOT, 'bin', 'gstack-improve');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-im-')); }
function improve(args: string[], root: string) {
  const o = spawnSync([PY, IMPROVE, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}
function run(args: string[], root: string) {
  const o = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim() };
}

/** Seed a usage log with N records across two skills. */
function seedUsage(root: string, n: number) {
  const dir = path.join(root, 'analytics');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(JSON.stringify({ skill: i % 2 ? 'qa' : 'ship', ts: '2026-08-12T00:00:00Z' }));
  }
  fs.writeFileSync(path.join(dir, 'skill-usage.jsonl'), lines.join('\n') + '\n');
}

describe('gstack-improve refuses to state a rate it cannot support', () => {
  // Sub-project D was sequenced last so it would not produce confident numbers
  // derived from nothing. B inherits that rule rather than repeating the
  // mistake one layer up.
  test('a thin sample is labelled indicative, a sufficient one measured', () => {
    const thin = tmp();
    seedUsage(thin, 3);
    const a = JSON.parse(improve([], thin).stdout)
      .find((f: any) => f.title.includes('recorded a use'));
    expect(a.basis.strength).toBe('indicative');
    expect(a.basis.why_indicative).toContain('not a rate');

    const thick = tmp();
    seedUsage(thick, 40);
    const b = JSON.parse(improve([], thick).stdout)
      .find((f: any) => f.title.includes('recorded a use'));
    expect(b.basis.strength).toBe('measured');
  }, T);

  test('--min-n moves the line', () => {
    const root = tmp();
    seedUsage(root, 10);
    const strength = (n: string) => JSON.parse(improve(['--min-n', n], root).stdout)
      .find((f: any) => f.title.includes('recorded a use')).basis.strength;
    expect(strength('5')).toBe('measured');
    expect(strength('50')).toBe('indicative');
  }, T);

  test('every finding carries the sample it came from', () => {
    const root = tmp();
    seedUsage(root, 5);
    for (const f of JSON.parse(improve([], root).stdout)) {
      expect(typeof f.basis.n).toBe('number');
      expect(['measured', 'indicative']).toContain(f.basis.strength);
    }
  }, T);
});

describe('gstack-improve counts what it could not read', () => {
  // A finding computed over a partly unreadable file is wrong in a direction
  // nobody can see, so the count travels with the figure.
  test('unreadable usage lines become their own finding', () => {
    const root = tmp();
    seedUsage(root, 4);
    fs.appendFileSync(path.join(root, 'analytics', 'skill-usage.jsonl'), '{"skill":"tru\n');
    const f = JSON.parse(improve([], root).stdout)
      .find((x: any) => x.title.includes('unreadable'));
    expect(f).toBeTruthy();
    expect(f.evidence.unreadable).toBe(1);
  }, T);
});

describe('gstack-improve files findings as work, not as a chart', () => {
  test('--file without --run is refused', () => {
    const root = tmp();
    seedUsage(root, 4);
    const r = improve(['--file'], root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--run');
  }, T);

  test('findings become queue items the supervisor can claim', () => {
    const root = tmp();
    seedUsage(root, 30);
    const runId = run(['init', '--goal', 'improvement cycle', '--budget', '10000'], root).stdout;

    const filed = improve(['--file', '--run', runId], root);
    expect(filed.code).toBe(0);
    expect(filed.stdout).toContain('filed');

    // The runtime must be able to hand one out for real work.
    const claimed = run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(claimed.code).toBe(0);
    expect(JSON.parse(claimed.stdout).title.length).toBeGreaterThan(14);
  }, T);
});

describe('gstack-improve with nothing to measure', () => {
  test('an empty state says so rather than inventing a finding', () => {
    const r = improve([], tmp());
    // Routing is a live census of installed skills, so it may still report.
    // What must never happen is a usage claim with no usage behind it.
    const usageClaim = r.code === 0
      ? JSON.parse(r.stdout).find((f: any) => f.title.includes('recorded a use'))
      : undefined;
    expect(usageClaim).toBeUndefined();
  }, T);
});
