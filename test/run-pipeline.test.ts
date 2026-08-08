import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const PIPE = path.join(ROOT, 'bin', 'gstack-pipeline');
const PY = process.env.GSTACK_PY || 'python';

function pipe(args: string[]) {
  const o = spawnSync([PY, PIPE, ...args]);
  return {
    code: o.exitCode,
    stdout: o.stdout.toString().trim(),
    stderr: o.stderr.toString().trim(),
  };
}

describe('gstack-pipeline', () => {
  test('a feature runs the full delivery sequence, in order', () => {
    const out = pipe(['--kind', 'feature']);
    expect(out.code).toBe(0);
    expect(out.stdout.split(/\r?\n/)).toEqual(
      ['spec', 'plan-eng-review', 'build', 'qa', 'review', 'ship']);
  });

  test('kinds genuinely differ — docs does not run qa', () => {
    const docs = pipe(['--kind', 'docs']).stdout.split(/\r?\n/);
    const feature = pipe(['--kind', 'feature']).stdout.split(/\r?\n/);
    expect(docs).not.toContain('qa');
    expect(feature).toContain('qa');
    // A table where every kind ran the same stages would make the kind pointless.
    expect(docs).not.toEqual(feature);
  });

  test('--after gives the next stage', () => {
    expect(pipe(['--kind', 'feature', '--after', 'qa']).stdout).toBe('review');
    expect(pipe(['--kind', 'bug', '--after', 'build']).stdout).toBe('qa');
  });

  test('the last stage reports completion rather than a next stage', () => {
    const out = pipe(['--kind', 'feature', '--after', 'ship']);
    expect(out.code).toBe(4);
    expect(out.stderr).toContain('complete');
  });

  test('an unknown kind and an unknown stage are distinguishable', () => {
    expect(pipe(['--kind', 'nonsense']).code).toBe(2);
    expect(pipe(['--kind', 'feature', '--after', 'nonsense']).code).toBe(3);
  });

  test('--kinds lists what is available', () => {
    const kinds = pipe(['--kinds']).stdout.split(/\r?\n/);
    expect(kinds).toContain('feature');
    expect(kinds).toContain('incident');
  });
});

describe('pipeline wired into the runtime', () => {
  const RUN = path.join(ROOT, 'bin', 'gstack-run');
  const os = require('os');
  const fs = require('fs');

  function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-pl-')); }
  function run(args: string[], root: string) {
    const o = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
    return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
  }

  test('claim reports the kind and the next stage to run', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['add', '--run', runId, '--title', 'add search', '--kind', 'feature'], root);

    const c = JSON.parse(run(['claim', '--run', runId, '--worker', 'w1'], root).stdout);
    expect(c.kind).toBe('feature');
    expect(c.next_stage).toBe('spec');
  });

  test('next_stage advances as stages are closed PROVEN, and survives a new claim', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'fix it', '--kind', 'bug'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    run(['journal', '--run', runId, '--item', item, '--claim', 'built the change required by this stage',
         '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output', '--stage', 'build'], root);

    // A fresh claim (as a later session would do) must resume at qa, not build.
    fs.rmSync(path.join(root, 'runs', runId, 'locks', `${item}.lock`), { force: true });
    const again = JSON.parse(run(['claim', '--run', runId, '--worker', 'w2'], root).stdout);
    expect(again.next_stage).toBe('qa');
  });

  test('a stage that was not PROVEN does not count as done', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'fix it', '--kind', 'bug'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'attempted the stage without proving it',
         '--verdict', 'UNPROVEN', '--evidence', 'no evidence gathered; the stage produced no output', '--stage', 'build'], root);

    fs.rmSync(path.join(root, 'runs', runId, 'locks', `${item}.lock`), { force: true });
    const again = JSON.parse(run(['claim', '--run', runId, '--worker', 'w2'], root).stdout);
    expect(again.next_stage).toBe('build');
  });

  test('an unknown kind is refused at add time', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const bad = run(['add', '--run', runId, '--title', 't', '--kind', 'nonsense'], root);
    expect(bad.code).toBe(20);
  });

  test('an item with no kind still works — kindless items are unaffected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['add', '--run', runId, '--title', 'plain'], root);
    const c = JSON.parse(run(['claim', '--run', runId, '--worker', 'w1'], root).stdout);
    expect(c.kind).toBeNull();
    expect(c.next_stage).toBeNull();
  });
});

describe('cyberteam engagements (sub-project C)', () => {
  const fs = require('fs');
  const CYBER = path.join(path.dirname(ROOT), 'cyberteam', 'skills');

  test('every cyber stage names a real cyberteam skill', () => {
    // The single most valuable check here: a pipeline that names a skill which
    // does not exist sends a worker to run nothing, and the stage would look
    // complete because there was nothing to fail.
    const kinds = pipe(['--kinds']).stdout.split(/\r?\n/).filter(k => k.startsWith('cyber:'));
    expect(kinds.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const k of kinds) {
      for (const stage of pipe(['--kind', k]).stdout.split(/\r?\n/)) {
        if (!fs.existsSync(path.join(CYBER, stage, 'SKILL.md'))) {
          missing.push(`${k}:${stage}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('cyber and dev kinds do not collide on the word incident', () => {
    const dev = pipe(['--kind', 'incident']).stdout.split(/\r?\n/);
    const cyber = pipe(['--kind', 'cyber:incident']).stdout.split(/\r?\n/);
    expect(dev).toContain('ship');       // dev incident ends in shipping code
    expect(cyber).toContain('forensics'); // cyber incident does not
    expect(cyber).not.toContain('ship');
    expect(dev).not.toEqual(cyber);
  });

  test('an audit engagement runs its stages in order', () => {
    expect(pipe(['--kind', 'cyber:audit']).stdout.split(/\r?\n/)).toEqual(
      ['audit-prep', 'questionnaire', 'soa', 'audit-response', 'soc-report']);
    expect(pipe(['--kind', 'cyber:audit', '--after', 'soa']).stdout).toBe('audit-response');
  });
});
