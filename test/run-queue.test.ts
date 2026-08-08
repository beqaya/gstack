import { describe, test, expect } from 'bun:test';
import { spawnSync, spawn } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-q-'));
}
function run(args: string[], root: string, extra: Record<string, string> = {}) {
  const out = spawnSync([PY, RUN, ...args], {
    env: { ...process.env, GSTACK_STATE_ROOT: root, ...extra },
  });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run queue', () => {
  test('an item can be claimed once, and not twice', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['add', '--run', runId, '--title', 'first job'], root);

    const a = run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(a.code).toBe(0);
    expect(JSON.parse(a.stdout).title).toBe('first job');

    const b = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(b.code).toBe(4);
    expect(b.stderr).toContain('no claimable items');
  });

  test('a stale lock is reclaimed so a dead worker does not strand the item', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    // Age the heartbeat past the TTL.
    const lock = path.join(root, 'runs', runId, 'locks', `${itemId}.lock`);
    const data = JSON.parse(fs.readFileSync(lock, 'utf-8'));
    data.heartbeat = '2000-01-01T00:00:00+00:00';
    fs.writeFileSync(lock, JSON.stringify(data));

    const again = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).item_id).toBe(itemId);
  });

  test('done removes the item from the claimable set', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['journal', '--run', runId, '--item', itemId, '--claim', 'the change under test behaves as specified', '--verdict', 'PROVEN', '--evidence', 'ran the command and observed the documented exit code and output'], root);
    expect(run(['done', '--run', runId, '--item', itemId], root).code).toBe(0);

    // Even with the lock gone, a completed item is never handed out again.
    fs.rmSync(path.join(root, 'runs', runId, 'locks', `${itemId}.lock`), { force: true });
    expect(run(['claim', '--run', runId, '--worker', 'w3'], root).code).toBe(4);
  });

  test('two workers racing one stale lock: exactly one wins', async () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'dead'], root);

    const lock = path.join(root, 'runs', runId, 'locks', `${itemId}.lock`);
    const data = JSON.parse(fs.readFileSync(lock, 'utf-8'));
    data.heartbeat = '2000-01-01T00:00:00+00:00';
    fs.writeFileSync(lock, JSON.stringify(data));

    const procs = ['a', 'b'].map((w) =>
      spawn([PY, RUN, 'claim', '--run', runId, '--worker', w], {
        env: { ...process.env, GSTACK_STATE_ROOT: root },
        stdout: 'pipe',
        stderr: 'pipe',
      })
    );

    const results = await Promise.all(procs.map(async (p) => {
      const code = await p.exited;
      const out = await new Response(p.stdout).text();
      const err = await new Response(p.stderr).text();
      return { code, out, err };
    }));

    const codes = results.map(r => r.code);
    const winners = codes.filter((c) => c === 0);
    const losers = codes.filter((c) => c !== 0);

    if (winners.length !== 1) {
      console.error('Race test failed:', { codes, results });
    }

    expect(winners.length).toBe(1);
    expect(losers).toEqual([4]);
  });

  test('three workers racing one stale lock: exactly one wins, no double-claim', async () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'dead'], root);

    const lock = path.join(root, 'runs', runId, 'locks', `${itemId}.lock`);
    const data = JSON.parse(fs.readFileSync(lock, 'utf-8'));
    data.heartbeat = '2000-01-01T00:00:00+00:00';
    fs.writeFileSync(lock, JSON.stringify(data));

    const procs = ['a', 'b', 'c'].map((w) =>
      spawn([PY, RUN, 'claim', '--run', runId, '--worker', w], {
        env: { ...process.env, GSTACK_STATE_ROOT: root },
        stdout: 'pipe',
        stderr: 'pipe',
      })
    );

    const results = await Promise.all(procs.map(async (p) => {
      const code = await p.exited;
      const out = await new Response(p.stdout).text();
      const err = await new Response(p.stderr).text();
      return { code, out, err };
    }));

    const codes = results.map(r => r.code);
    expect(codes.filter((c) => c === 0).length).toBe(1);
  });

  test('a freshly-created but still-empty lock is respected, not reaped', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;

    // Simulate a worker that has completed its O_EXCL create — which commits
    // ownership — but has not yet written its heartbeat.
    const lock = path.join(root, 'runs', runId, 'locks', `${itemId}.lock`);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, '');

    // The item is owned. A claim must NOT hand it to anyone else.
    const other = run(['claim', '--run', runId, '--worker', 'other'], root);
    expect(other.code).toBe(4);
    expect(fs.existsSync(lock)).toBe(true);
  });

  test('a corrupt queue.jsonl line stops work being handed out', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['add', '--run', runId, '--title', 'job'], root);
    fs.appendFileSync(path.join(root, 'runs', runId, 'queue.jsonl'), '{"event":"ad');

    const c = run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(c.code).toBe(11);
  });
});

describe('wrong-shaped JSON lines', () => {
  test('a line that is valid JSON but not an object counts as unreadable, not a crash', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['add', '--run', runId, '--title', 'job'], root);
    // Valid JSON, wrong shape — previously raised a raw KeyError (exit 1).
    fs.appendFileSync(path.join(root, 'runs', runId, 'queue.jsonl'), '"just a string"\n');

    const c = run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(c.code).toBe(11);
    expect(c.stderr).toContain('unreadable');
  });

  test('an object missing required keys is skipped, not fatal', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    // Well-formed JSON object, but no event/item_id — must not raise.
    fs.appendFileSync(path.join(root, 'runs', runId, 'queue.jsonl'), '{"note":"hi"}\n');

    const c = run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(c.code).toBe(0);
    expect(JSON.parse(c.stdout).item_id).toBe(item);
  });
});

describe('release: hand an item back without completing it', () => {
  test('the holder can release, and the item becomes claimable again', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    expect(run(['release', '--run', runId, '--item', item, '--worker', 'w1'], root).code).toBe(0);

    const again = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).item_id).toBe(item);
  });

  test('releasing someone else claim is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    const thief = run(['release', '--run', runId, '--item', item, '--worker', 'w2'], root);
    expect(thief.code).toBe(24);
    expect(thief.stderr).toContain('held by');
    // w1 still holds it.
    expect(run(['claim', '--run', runId, '--worker', 'w3'], root).code).toBe(4);
  });

  test('releasing an unclaimed item is refused', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    expect(run(['release', '--run', runId, '--item', item, '--worker', 'w1'], root).code).toBe(24);
  });
});
