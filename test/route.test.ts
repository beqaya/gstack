import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const ROUTE = path.join(ROOT, 'bin', 'gstack-route');
const PY = process.env.GSTACK_PY || 'python';
// Each test spawns a process; Windows creation cost trips Bun's 5s default,
// which surfaces as a null exit code rather than a failure.
const T = 120000;

function route(args: string[]) {
  const o = spawnSync([PY, ROUTE, ...args], { env: { ...process.env } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}

describe('gstack-route resolves, and refuses to guess', () => {
  test('a claimed phrase resolves to exactly one skill', () => {
    const r = route(['--intent', 'check for vulnerabilities']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('gstack:cso');
  }, T);

  test('punctuation and case do not change the answer', () => {
    expect(route(['--intent', 'Check For Vulnerabilities!']).stdout).toBe('gstack:cso');
  }, T);

  // The failure this tool exists for: an unclaimed intent must produce data,
  // not a guess. A silent guess costs a full skill load and teaches nothing.
  test('an unclaimed intent exits 2 and suggests near misses', () => {
    const r = route(['--intent', 'do security testing']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no skill claims');
    expect(r.stderr).toContain('security');
  }, T);

  test('no phrase is claimed by two skills', () => {
    const index = JSON.parse(route(['--index']).stdout);
    const contested = Object.entries<string[]>(index).filter(([, o]) => o.length > 1);
    expect(contested).toEqual([]);
  }, T);
});

describe('routing coverage', () => {
  // 61 of 120 skills declare no triggers, so no table can reach them. This
  // test states the current number so that it can only go DOWN: any skill
  // added without triggers fails the build.
  const KNOWN_UNROUTED = 19;

  test('the unrouted set does not grow', () => {
    const lines = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(KNOWN_UNROUTED);
  }, T);

  test('every gstack skill except run-supervisor is routable', () => {
    const unrouted = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    const gstackUnrouted = unrouted.filter(l => l.startsWith('gstack:'));
    expect(gstackUnrouted).toEqual([]);
  }, T);
});
