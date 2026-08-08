import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-run-'));
}

function run(args: string[], stateRoot: string) {
  const out = spawnSync([PY, RUN, ...args], {
    env: { ...process.env, GSTACK_STATE_ROOT: stateRoot },
  });
  return {
    code: out.exitCode,
    stdout: out.stdout.toString().trim(),
    stderr: out.stderr.toString().trim(),
  };
}

describe('gstack-run init/status', () => {
  test('init creates a run dir and status reports it back', () => {
    const root = tmpRoot();
    const init = run(['init', '--goal', 'fix the widget', '--budget', '50000'], root);
    expect(init.code).toBe(0);
    const runId = init.stdout;
    expect(runId.length).toBeGreaterThan(0);

    const dir = path.join(root, 'runs', runId);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    const st = run(['status', '--run', runId], root);
    expect(st.code).toBe(0);
    const m = JSON.parse(st.stdout);
    expect(m.schema).toBe(1);
    expect(m.goal).toBe('fix the widget');
    expect(m.budget_tokens).toBe(50000);
    expect(m.status).toBe('active');
    expect(m.run_id).toBe(runId);
    expect(m.created_at).toBeTruthy();
  });

  test('status on an unknown schema halts instead of guessing', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10'], root).stdout;
    const mf = path.join(root, 'runs', runId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
    m.schema = 99;
    fs.writeFileSync(mf, JSON.stringify(m));

    const st = run(['status', '--run', runId], root);
    expect(st.code).not.toBe(0);
    expect(st.stderr).toContain('schema');
  });
});

describe('gstack-run stop/report', () => {
  test('stopping writes a resume point and the report separates done from open', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    const a = run(['add', '--run', runId, '--title', 'done job'], root).stdout;
    run(['add', '--run', runId, '--title', 'unfinished job'], root);
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', a, '--claim', 'done', '--verdict', 'PROVEN', '--evidence', 'e'], root);
    run(['done', '--run', runId, '--item', a], root);

    const s = run(['stop', '--run', runId, '--why', 'budget-exhausted'], root);
    expect(s.code).toBe(0);
    expect(fs.existsSync(path.join(root, 'runs', runId, 'resume.json'))).toBe(true);

    const rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.status).toBe('stopped');
    expect(rep.stopped_because).toBe('budget-exhausted');
    expect(rep.completed).toBe(1);
    expect(rep.open).toBe(1);
  });

  test('parked work is reported separately, never counted as completed', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    const a = run(['add', '--run', runId, '--title', 'finished'], root).stdout;
    const b = run(['add', '--run', runId, '--title', 'needs approval'], root).stdout;
    run(['add', '--run', runId, '--title', 'never started'], root);

    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', a, '--claim', 'done', '--verdict', 'PROVEN', '--evidence', 'e'], root);
    run(['done', '--run', runId, '--item', a], root);
    run(['claim', '--run', runId, '--worker', 'w2'], root);
    run(['park', '--run', runId, '--item', b, '--action', 'deploy', '--reason', 'prod'], root);

    const rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.completed).toBe(1);
    expect(rep.parked).toBe(1);
    expect(rep.open).toBe(1);
  });

  test('all three stop reasons write a resume point', () => {
    for (const why of ['queue-drained', 'budget-exhausted', 'breaker-tripped']) {
      const root = tmpRoot();
      const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
      expect(run(['stop', '--run', runId, '--why', why], root).code).toBe(0);
      expect(fs.existsSync(path.join(root, 'runs', runId, 'resume.json'))).toBe(true);
      expect(JSON.parse(run(['report', '--run', runId], root).stdout).stopped_because).toBe(why);
    }
  });

  test('an unrecognised stop reason is rejected and nothing is written', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const bad = run(['stop', '--run', runId, '--why', 'because-i-said-so'], root);
    expect(bad.code).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'runs', runId, 'resume.json'))).toBe(false);
    expect(JSON.parse(run(['report', '--run', runId], root).stdout).status).toBe('active');
  });

  test('a corrupt parked.jsonl line makes report fail closed rather than reclassifying an approval as completed', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', item, '--action', 'deploy', '--reason', 'prod'], root);
    fs.appendFileSync(path.join(root, 'runs', runId, 'parked.jsonl'), '{"item_id":"tru');

    const rep = run(['report', '--run', runId], root);
    expect(rep.code).toBe(10);
    const parsed = JSON.parse(rep.stdout);
    // The item is really parked, not completed — a corrupt line must not
    // reclassify a founder approval into the completed count.
    expect(parsed.completed).toBe(0);
  });

  test('report includes exhausted and ledger_unreadable_lines so a corrupt ledger is visible', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '5'], root);
    fs.appendFileSync(path.join(root, 'runs', runId, 'ledger.jsonl'), '{"agent":"w","tok');

    const rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.exhausted).toBe(true);
    expect(rep.ledger_unreadable_lines).toBe(1);
  });

  test('report works mid-run, before any stop', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '500'], root).stdout;
    run(['add', '--run', runId, '--title', 'in flight'], root);
    run(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '25'], root);

    const rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.status).toBe('active');
    expect(rep.stopped_because).toBeNull();
    expect(rep.open).toBe(1);
    expect(rep.spent).toBe(25);
  });
});

describe('gstack-run done --touched', () => {
  function git(args: string[], cwd: string) {
    return spawnSync(['git', ...args], { cwd, env: { ...process.env } });
  }

  function readyItem(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'c',
         '--verdict', 'PROVEN', '--evidence', 'e'], root);
    return { runId, item };
  }

  test('uncommitted work is refused, and the same file passes once committed', () => {
    const root = tmpRoot();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-repo-'));
    git(['init'], repo);
    git(['config', 'user.email', 't@example.com'], repo);
    git(['config', 'user.name', 'test'], repo);
    const f = path.join(repo, 'work.txt');
    fs.writeFileSync(f, 'changed but not committed\n');

    const { runId, item } = readyItem(root);
    const dirty = run(['done', '--run', runId, '--item', item, '--touched', f], root);
    expect(dirty.code).toBe(17);
    expect(dirty.stderr).toContain('uncommitted');

    git(['add', 'work.txt'], repo);
    git(['commit', '-m', 'land it'], repo);

    const clean = run(['done', '--run', runId, '--item', item, '--touched', f], root);
    expect(clean.code).toBe(0);
  });

  test('a path outside any git repo does not block done', () => {
    const root = tmpRoot();
    const loose = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-nogit-')), 'x.txt');
    fs.writeFileSync(loose, 'no repo here\n');

    const { runId, item } = readyItem(root);
    expect(run(['done', '--run', runId, '--item', item, '--touched', loose], root).code).toBe(0);
  });
});

describe('exit codes are distinguishable from argparse', () => {
  test('an unknown run exits 21, not argparse usage code 2', () => {
    const root = tmpRoot();
    const missing = run(['status', '--run', 'doesnotexist'], root);
    expect(missing.code).toBe(21);
    expect(missing.stderr).toContain('no such run');
  });

  test('a genuine usage error still exits 2 — the two are now separable', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10'], root).stdout;
    // --nonsense is not a flag; argparse owns this failure.
    const bad = run(['status', '--run', runId, '--nonsense'], root);
    expect(bad.code).toBe(2);
  });
});
