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
});
