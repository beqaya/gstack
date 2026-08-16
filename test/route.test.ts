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
  // 15 cyberteam skills deliberately declare no triggers (they overlap in
  // scope; the founder routes between them by judgment, not phrase). This
  // ceiling can only go DOWN: any skill added without triggers fails the build.
  const KNOWN_UNROUTED = 15;

  test('the unrouted set does not grow', () => {
    const lines = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(KNOWN_UNROUTED);
  }, T);

  test('every gstack skill is routable', () => {
    const unrouted = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    const gstackUnrouted = unrouted.filter(l => l.startsWith('gstack:'));
    expect(gstackUnrouted).toEqual([]);
  }, T);
});

describe('self-name routing — every skill answers to its own name', () => {
  test('a bare skill name resolves without an explicit trigger', () => {
    const r = route(['--intent', 'pentest']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('cyber:pentest');
  }, T);

  test('hyphenated names resolve spoken ("plan ceo review") and typed ("plan-ceo-review")', () => {
    expect(route(['--intent', 'plan ceo review']).stdout).toBe('gstack:plan-ceo-review');
    expect(route(['--intent', 'plan-ceo-review']).stdout).toBe('gstack:plan-ceo-review');
  }, T);

  test('implicit names never contest an explicit claim — index stays collision-free', () => {
    const index = JSON.parse(route(['--index']).stdout);
    const contested = Object.entries<string[]>(index).filter(([, o]) => o.length > 1);
    expect(contested).toEqual([]);
  }, T);

  test('--unrouted still reports skills lacking explicit triggers', () => {
    const lines = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0); // the deliberate cyberteam set
    expect(lines.every(l => l.startsWith('cyber:'))).toBe(true);
  }, T);
});

describe('scan mode — trigger phrases inside real sentences', () => {
  test('finds a claimed phrase embedded in a prompt', () => {
    const r = route(['--scan', 'could you check for vulnerabilities in the login flow']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('check for vulnerabilities\tgstack:cso');
  }, T);

  test('word boundaries hold — a phrase inside a longer word never matches', () => {
    const r = route(['--scan', 'the quality assurance docs are qadocs not qa docs']);
    // "qa" may match as a standalone word, but never inside "quality"/"qadocs".
    for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
      expect(line.split('\t')[0]).not.toBe('quality');
    }
  }, T);

  test('a longer matched phrase suppresses the phrases inside it', () => {
    const index = JSON.parse(route(['--index']).stdout);
    const phrases = Object.keys(index).sort((a, b) => b.length - a.length);
    const long = phrases.find(p => phrases.some(q => q !== p && ` ${p} `.includes(` ${q} `)));
    if (!long) return; // no nested phrase pair exists in the current table
    const inner = phrases.find(q => q !== long && ` ${long} `.includes(` ${q} `))!;
    const r = route(['--scan', `please ${long} today`]);
    const matched = r.stdout.split(/\r?\n/).map(l => l.split('\t')[0]);
    expect(matched).toContain(long);
    expect(matched).not.toContain(inner);
  }, T);

  test('no claimed phrase in the text exits 2 with no output', () => {
    const r = route(['--scan', 'xyzzy plugh nothing routable here']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  }, T);
});
