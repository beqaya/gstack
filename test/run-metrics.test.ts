import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const METRICS = path.join(ROOT, 'bin', 'gstack-metrics');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-m-')); }
function metrics(args: string[], root: string) {
  const o = spawnSync([PY, METRICS, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}

/** Build a run on disk without going through the CLI, so a test can express
 *  states a healthy run would never reach. */
function makeRun(root: string, id: string, opts: {
  status?: string, why?: string | null, journal?: any[], ledger?: any[], parked?: any[],
} = {}) {
  const d = path.join(root, 'runs', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({
    schema: 1, run_id: id, goal: 'g', budget_tokens: 1000,
    status: opts.status ?? 'stopped', stopped_because: opts.why ?? 'queue-drained',
  }));
  const jsonl = (recs: any[]) => recs.map(r => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : '');
  fs.writeFileSync(path.join(d, 'journal.jsonl'), jsonl(opts.journal ?? []));
  fs.writeFileSync(path.join(d, 'ledger.jsonl'), jsonl(opts.ledger ?? []));
  fs.writeFileSync(path.join(d, 'queue.jsonl'), '');
  fs.writeFileSync(path.join(d, 'parked.jsonl'), jsonl(opts.parked ?? []));
  return d;
}

describe('gstack-metrics — every figure names where it came from', () => {
  // D's first acceptance criterion. A number nobody can trace is a number
  // nobody can argue with, which makes it useless for changing a decision.
  test('every metric carries the run ids it was computed from', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {
      journal: [{ entry_id: 'e1', item_id: 'i1', verdict: 'PROVEN', stage: 'build', tier: 'routine' }],
      ledger: [{ agent: 'w1', phase: 'work', tokens: 100 }],
    });
    makeRun(root, 'bbbbbbbbbbbb', {
      journal: [{ entry_id: 'e2', item_id: 'i2', verdict: 'CONTRADICTED', stage: 'qa', tier: 'routine' }],
      ledger: [{ agent: 'w2', phase: 'verify', tokens: 50 }],
    });

    const report = JSON.parse(metrics([], root).stdout);
    for (const [name, body] of Object.entries<any>(report)) {
      if (name === 'findings') continue;
      expect(body.basis).toBeTruthy();
      expect(Array.isArray(body.basis.runs)).toBe(true);
      expect(body.basis.runs.length).toBeGreaterThan(0);
    }
  });

  // D's third criterion. Token spend is self-reported by the worker; the
  // harness knows the real figure and gstack does not.
  test('token spend is labelled estimated, and other metrics are not', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {
      journal: [{ entry_id: 'e1', item_id: 'i1', verdict: 'PROVEN', stage: 'build' }],
      ledger: [{ agent: 'w1', phase: 'work', tokens: 100 }],
    });
    const report = JSON.parse(metrics([], root).stdout);
    expect(report.spend.basis.estimated).toContain('self-reported');
    expect(report.verdicts.basis.estimated).toBeUndefined();
  });

  test('a thin sample is marked indicative, a sufficient one measured', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {
      journal: [1, 2, 3].map(n => ({ entry_id: `e${n}`, item_id: 'i1', verdict: 'PROVEN', stage: 'build' })),
    });

    expect(JSON.parse(metrics(['--metric', 'verdicts'], root).stdout)
      .verdicts.basis.strength).toBe('indicative');
    expect(JSON.parse(metrics(['--metric', 'verdicts', '--min-n', '3'], root).stdout)
      .verdicts.basis.strength).toBe('measured');
  });

  test('the verify-to-work ratio is computed, and is null when no work is recorded', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {
      ledger: [{ phase: 'work', tokens: 100 }, { phase: 'verify', tokens: 250 }],
    });
    expect(JSON.parse(metrics(['--metric', 'spend'], root).stdout)
      .spend.verify_to_work_ratio).toBe(2.5);

    const bare = tmpRoot();
    makeRun(bare, 'aaaaaaaaaaaa', { ledger: [{ phase: 'verify', tokens: 250 }] });
    expect(JSON.parse(metrics(['--metric', 'spend'], bare).stdout)
      .spend.verify_to_work_ratio).toBeNull();
  });
});

describe('gstack-metrics — findings are work, not charts', () => {
  // D's third scope item: a metric that identifies a weak stage should produce
  // a queue item, not a chart nobody opens.
  test('elevated work with no verifier named becomes a finding that points at the entries', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {
      journal: [
        { entry_id: 'good', item_id: 'i1', verdict: 'PROVEN', stage: 'build', tier: 'elevated', verifier: 'agent-b' },
        { entry_id: 'bad', item_id: 'i2', verdict: 'PROVEN', stage: 'ship', tier: 'elevated' },
      ],
    });
    const cov = JSON.parse(metrics(['--metric', 'verifier-coverage'], root).stdout)['verifier-coverage'];
    expect(cov.verifier_named).toBe(1);
    expect(cov.verifier_missing).toBe(1);

    const f = JSON.parse(metrics(['--findings'], root).stdout);
    const hit = f.find((x: any) => x.title.includes('no verifier named'));
    expect(hit).toBeTruthy();
    expect(JSON.stringify(hit.evidence)).toContain('bad');
  });

  test('a stage whose claims were overturned is surfaced with its counts', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {
      journal: [
        { entry_id: 'e1', item_id: 'i1', verdict: 'PROVEN', stage: 'build' },
        { entry_id: 'e2', item_id: 'i1', verdict: 'CONTRADICTED', stage: 'build', supersedes: 'e1' },
      ],
    });
    const f = JSON.parse(metrics(['--findings'], root).stdout);
    const hit = f.find((x: any) => x.title.includes("stage 'build'"));
    expect(hit).toBeTruthy();
    expect(hit.evidence.counts.CONTRADICTED).toBe(1);
    expect(hit.evidence.counts.superseded).toBe(1);
  });

  // The whole reason D was specified last. Precise-looking numbers derived
  // from four runs are the failure this project exists to prevent.
  test('a thin dataset reports itself as the first thing wrong with the report', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {});
    const f = JSON.parse(metrics(['--findings'], root).stdout);
    expect(f.some((x: any) => x.title.includes('too few runs'))).toBe(true);
  });
});

describe('gstack-metrics — a partial read is never silent', () => {
  test('unreadable lines are counted and reported, not skipped', () => {
    const root = tmpRoot();
    const d = makeRun(root, 'aaaaaaaaaaaa', {
      journal: [{ entry_id: 'e1', item_id: 'i1', verdict: 'PROVEN', stage: 'build' }],
    });
    fs.appendFileSync(path.join(d, 'journal.jsonl'), '{"entry_id":"trunc');

    const integ = JSON.parse(metrics(['--metric', 'integrity'], root).stdout).integrity;
    expect(integ.total_unreadable).toBe(1);
    expect(integ.runs_with_unreadable_lines['aaaaaaaaaaaa']).toBe(1);

    const f = JSON.parse(metrics(['--findings'], root).stdout);
    expect(f.some((x: any) => x.title.includes('unreadable'))).toBe(true);
  });

  test('a JSON line of the wrong shape counts as unreadable rather than passing through', () => {
    const root = tmpRoot();
    const d = makeRun(root, 'aaaaaaaaaaaa', {});
    fs.appendFileSync(path.join(d, 'journal.jsonl'), '"a bare string"\n');
    expect(JSON.parse(metrics(['--metric', 'integrity'], root).stdout)
      .integrity.total_unreadable).toBe(1);
  });
});

describe('gstack-metrics — refusals', () => {
  test('no runs at all is an error, not an empty report', () => {
    const root = tmpRoot();
    const r = metrics([], root);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('nothing to measure');
  });

  test('an unknown metric is refused and names the known ones', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {});
    const r = metrics(['--metric', 'nonsense'], root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('verdicts');
  });

  test('a directory without a manifest is ignored rather than crashing', () => {
    const root = tmpRoot();
    makeRun(root, 'aaaaaaaaaaaa', {});
    fs.mkdirSync(path.join(root, 'runs', 'not-a-run'), { recursive: true });
    const r = metrics(['--metric', 'outcomes'], root);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).outcomes.basis.runs).toEqual(['aaaaaaaaaaaa']);
  });
});
