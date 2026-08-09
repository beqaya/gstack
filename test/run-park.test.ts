import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-p-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run park', () => {
  test('parking one item leaves the others claimable', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const blocked = run(['add', '--run', runId, '--title', 'push to main'], root).stdout;
    run(['add', '--run', runId, '--title', 'independent work'], root);

    run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(run(['park', '--run', runId, '--item', blocked,
                '--action', 'git push origin main',
                '--reason', 'pushing to main needs founder approval'], root).code).toBe(0);

    // The run continues: the other item is still claimable.
    const next = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout).title).toBe('independent work');
  });

  test('a parked item is never handed out again', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const only = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', only, '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root);

    expect(run(['claim', '--run', runId, '--worker', 'w2'], root).code).toBe(4);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(1);
    expect(parked[0].action).toBe('deploy the release to production');
  });

  test('parking the same item twice is refused, so the founder sees one approval', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    expect(run(['park', '--run', runId, '--item', item,
                '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root).code).toBe(0);

    const second = run(['park', '--run', runId, '--item', item,
                        '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root);
    expect(second.code).toBe(8);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(1);
  });

  test('parking an already-completed item is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', item, '--claim', 'the item behaves as specified after the change', '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    run(['done', '--run', runId, '--item', item], root);

    const late = run(['park', '--run', runId, '--item', item,
                      '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root);
    expect(late.code).toBe(8);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(0);
  });

  // The founder reads --action and --reason and nothing else when deciding.
  // The journal gained this gate first and park did not, which put stand-in
  // values into the one list a human is asked to act on.
  test('a parked item must say what to approve and why', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    expect(run(['park', '--run', runId, '--item', item,
                '--action', 'x', '--reason', 'x'], root).code).toBe(22);
    // Not a known placeholder, still too short to act on.
    expect(run(['park', '--run', runId, '--item', item,
                '--action', 'approve',
                '--reason', 'the founder has to decide this'], root).code).toBe(22);
    expect(run(['park', '--run', runId, '--item', item,
                '--action', 'merge PR #72', '--reason', 'blocked'], root).code).toBe(22);

    // Nothing reached the approval list.
    expect(JSON.parse(run(['parked', '--run', runId], root).stdout).length).toBe(0);

    expect(run(['park', '--run', runId, '--item', item,
                '--action', 'merge PR #72',
                '--reason', 'merging to main auto-deploys production'], root).code).toBe(0);
  });

  test('a corrupt parked.jsonl line fails closed rather than hiding an approval', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'deploy'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', item, '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root);
    fs.appendFileSync(path.join(root, 'runs', runId, 'parked.jsonl'), '{"item_id":"tru');

    const p = run(['parked', '--run', runId], root);
    expect(p.code).toBe(10);
    expect(p.stderr).toContain('MISSING');
  });

  test('a corrupt queue line stops park writing a false approval', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    fs.appendFileSync(path.join(root, 'runs', runId, 'queue.jsonl'), '{"event":"do');

    const p = run(['park', '--run', runId, '--item', item,
                   '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root);
    expect(p.code).toBe(11);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(0);
  });
});

describe('gstack-run resolve', () => {
  function parkOne(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', item, '--action', 'deploy the release to production', '--reason', 'production deploys need founder approval'], root);
    return { runId, item };
  }

  test('an approved item stops counting as awaiting the founder', () => {
    const root = tmpRoot();
    const { runId, item } = parkOne(root);

    let rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.parked).toBe(1);
    expect(rep.parked_resolved).toBe(0);

    expect(run(['resolve', '--run', runId, '--item', item,
                '--decision', 'approved', '--note', 'pushed by hand'], root).code).toBe(0);

    rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.parked).toBe(0);
    expect(rep.parked_resolved).toBe(1);
    // Resolved approval is still not work this run completed.
    expect(rep.completed).toBe(0);
  });

  test('the decision is visible in the parked list', () => {
    const root = tmpRoot();
    const { runId, item } = parkOne(root);
    run(['resolve', '--run', runId, '--item', item, '--decision', 'declined',
         '--note', 'not now'], root);

    const list = JSON.parse(run(['parked', '--run', runId], root).stdout);
    const settled = list.find((x: any) => x.item_id === item && x.status === 'resolved');
    expect(settled.decision).toBe('declined');
    expect(settled.note).toBe('not now');
  });

  test('resolving twice, or resolving something never parked, is refused', () => {
    const root = tmpRoot();
    const { runId, item } = parkOne(root);
    run(['resolve', '--run', runId, '--item', item, '--decision', 'approved'], root);

    expect(run(['resolve', '--run', runId, '--item', item,
                '--decision', 'declined'], root).code).toBe(18);
    expect(run(['resolve', '--run', runId, '--item', 'neverparked',
                '--decision', 'approved'], root).code).toBe(18);
  });
});

// An approval request that has gone stale must be correctable. One did: an
// item was parked asking to push three commits, two more landed while it
// waited, and no command could change the text — park refused as terminal,
// resolve closed it instead of correcting it, claim would not hand it back.
describe('gstack-run amend', () => {
  function parked(root: string) {
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', item,
         '--action', 'push three commits to the fork',
         '--reason', 'pushing needs founder approval before it happens'], root);
    return { runId, item };
  }
  const list = (runId: string, root: string) =>
    JSON.parse(run(['parked', '--run', runId], root).stdout);
  const report = (runId: string, root: string) =>
    JSON.parse(run(['report', '--run', runId], root).stdout);

  test('amending replaces what the founder is asked to approve', () => {
    const root = tmpRoot();
    const { runId, item } = parked(root);

    expect(run(['amend', '--run', runId, '--item', item,
                '--action', 'push five commits to the fork',
                '--reason', 'two more commits landed while this waited'], root).code).toBe(0);

    const l = list(runId, root);
    expect(l.length).toBe(1);
    expect(l[0].action).toBe('push five commits to the fork');
    expect(l[0].status).toBe('awaiting');
    expect(report(runId, root).parked).toBe(1);
  });

  // The founder's ruling: a request whose substance changed after it was
  // answered has not been answered.
  test('amending an already-decided request puts it back in front of the founder', () => {
    const root = tmpRoot();
    const { runId, item } = parked(root);
    run(['resolve', '--run', runId, '--item', item, '--decision', 'approved'], root);
    expect(report(runId, root).parked).toBe(0);
    expect(report(runId, root).parked_resolved).toBe(1);

    run(['amend', '--run', runId, '--item', item,
         '--action', 'push five commits to the fork',
         '--reason', 'two more commits landed after you approved this'], root);

    expect(list(runId, root)[0].status).toBe('awaiting');
    expect(report(runId, root).parked).toBe(1);
    expect(report(runId, root).parked_resolved).toBe(0);

    // And it can be decided again — the reset is not a dead end.
    expect(run(['resolve', '--run', runId, '--item', item,
                '--decision', 'approved'], root).code).toBe(0);
    const settled = list(runId, root);
    expect(settled[0].status).toBe('resolved');
    expect(settled[0].action).toBe('push five commits to the fork');
  });

  test('resolving twice without an amend in between is still refused', () => {
    const root = tmpRoot();
    const { runId, item } = parked(root);
    run(['resolve', '--run', runId, '--item', item, '--decision', 'approved'], root);
    expect(run(['resolve', '--run', runId, '--item', item,
                '--decision', 'declined'], root).code).toBe(18);
  });

  test('amending something never parked is refused', () => {
    const root = tmpRoot();
    const { runId } = parked(root);
    expect(run(['amend', '--run', runId, '--item', 'neverparked',
                '--action', 'git push',
                '--reason', 'this item was never parked in the first place'], root).code).toBe(18);
  });

  test('an amended request must say as much as the original did', () => {
    const root = tmpRoot();
    const { runId, item } = parked(root);
    expect(run(['amend', '--run', runId, '--item', item, '--action', 'x',
                '--reason', 'x'], root).code).toBe(22);
    expect(list(runId, root)[0].action).toBe('push three commits to the fork');
  });

  // A parked action is short by nature. A floor that rejects `git push`
  // teaches the caller to pad, which is the vacuity the gate exists to stop.
  test('the action floor admits real terse actions and still rejects stubs', () => {
    const root = tmpRoot();
    const { runId, item } = parked(root);
    const REASON = 'pushing needs founder approval before it happens';
    for (const action of ['git push', 'merge PR #72', 'rotate key']) {
      expect(run(['amend', '--run', runId, '--item', item,
                  '--action', action, '--reason', REASON], root).code).toBe(0);
    }
    for (const action of ['deploy', 'approve', 'x']) {
      expect(run(['amend', '--run', runId, '--item', item,
                  '--action', action, '--reason', REASON], root).code).toBe(22);
    }
  });
});
