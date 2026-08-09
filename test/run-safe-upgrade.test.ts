import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const UPGRADE = path.join(ROOT, 'bin', 'gstack-safe-upgrade');
const PY = process.env.GSTACK_PY || 'python';
// Each test spawns ~12 git processes; Windows process creation trips
// Bun's 5s default timeout, which surfaces as a null exit code.
const T = 120000;

function git(args: string[], cwd: string) {
  const o = spawnSync(['git', '-c', 'user.email=t@t.t', '-c', 'user.name=t',
                       '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}
function upgrade(dir: string, extra: string[] = []) {
  const o = spawnSync([PY, UPGRADE, '--dir', dir, ...extra], { cwd: dir, env: { ...process.env } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}
function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-u-')); }

function commit(repo: string, file: string, body: string, msg: string) {
  fs.writeFileSync(path.join(repo, file), body);
  git(['add', file], repo);
  git(['commit', '-m', msg], repo);
  return git(['rev-parse', 'HEAD'], repo).stdout;
}

/** An upstream project plus a clone of it, the plain (non-fork) topology. */
function pair() {
  const up = tmp();
  git(['init', '--initial-branch=main'], up);
  commit(up, 'VERSION', '1.0.0\n', 'initial');
  const inst = tmp();
  git(['clone', up, inst], path.dirname(inst));
  return { up, inst };
}

describe('gstack-safe-upgrade — local work survives the upgrade', () => {
  // The command this replaces was `git reset --hard origin/main`, which moves
  // the CURRENT branch to upstream's tip. Every local commit leaves the tree.
  test('a customised checkout keeps its commits and gains the upstream ones', () => {
    const { up, inst } = pair();
    const mine = commit(inst, 'my-tool.py', 'print(1)\n', 'my customisation');
    const theirs = commit(up, 'THEIRS', 'new upstream file\n', 'upstream work');

    const r = upgrade(inst);
    expect(r.code).toBe(0);

    // Both histories are reachable — nothing was discarded.
    expect(git(['merge-base', '--is-ancestor', mine, 'HEAD'], inst).code).toBe(0);
    expect(git(['merge-base', '--is-ancestor', theirs, 'HEAD'], inst).code).toBe(0);
    expect(fs.existsSync(path.join(inst, 'my-tool.py'))).toBe(true);
    expect(fs.existsSync(path.join(inst, 'THEIRS'))).toBe(true);
  }, T);

  test('a pristine checkout fast-forwards rather than creating a merge commit', () => {
    const { up, inst } = pair();
    const theirs = commit(up, 'THEIRS', 'x\n', 'upstream work');

    const r = upgrade(inst);
    expect(r.code).toBe(0);
    expect(git(['rev-parse', 'HEAD'], inst).stdout).toBe(theirs);
    // A fast-forward leaves one parent; a merge commit would have two.
    expect(git(['rev-list', '--parents', '-n', '1', 'HEAD'], inst).stdout.split(' ').length).toBe(2);
  }, T);

  test('an up-to-date checkout is a no-op that says so', () => {
    const { inst } = pair();
    const before = git(['rev-parse', 'HEAD'], inst).stdout;
    const r = upgrade(inst);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('already current');
    expect(git(['rev-parse', 'HEAD'], inst).stdout).toBe(before);
  }, T);
});

describe('gstack-safe-upgrade — it refuses rather than guessing', () => {
  // The old path stashed silently and mentioned it in a prose warning. A stash
  // the user does not know about is indistinguishable from lost work.
  test('uncommitted tracked changes stop the upgrade, and nothing is stashed', () => {
    const { up, inst } = pair();
    commit(up, 'THEIRS', 'x\n', 'upstream work');
    fs.writeFileSync(path.join(inst, 'VERSION'), 'my edit in progress\n');

    const r = upgrade(inst);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('VERSION');
    // The edit is still exactly where the user left it.
    expect(fs.readFileSync(path.join(inst, 'VERSION'), 'utf8')).toBe('my edit in progress\n');
    expect(git(['stash', 'list'], inst).stdout).toBe('');
    expect(fs.existsSync(path.join(inst, 'THEIRS'))).toBe(false);
  }, T);

  test('untracked files do not block the upgrade', () => {
    const { up, inst } = pair();
    commit(up, 'THEIRS', 'x\n', 'upstream work');
    fs.mkdirSync(path.join(inst, '.sdd'), { recursive: true });
    fs.writeFileSync(path.join(inst, '.sdd', 'scratch.md'), 'notes\n');

    expect(upgrade(inst).code).toBe(0);
    expect(fs.existsSync(path.join(inst, '.sdd', 'scratch.md'))).toBe(true);
  }, T);

  test('a detached HEAD is refused — there is no branch to merge into', () => {
    const { up, inst } = pair();
    commit(up, 'THEIRS', 'x\n', 'upstream work');
    git(['checkout', '--detach', 'HEAD'], inst);

    const r = upgrade(inst);
    expect(r.code).toBe(5);
    expect(r.stderr).toContain('detached');
  }, T);

  test('a remote with no main branch is refused', () => {
    const { inst } = pair();
    git(['branch', '-m', 'main', 'trunk'], inst);
    git(['remote', 'set-branches', 'origin', 'trunk'], inst);
    git(['update-ref', '-d', 'refs/remotes/origin/main'], inst);
    expect(upgrade(inst).code).toBe(6);
  }, T);

  test('a directory that is not a repository is refused', () => {
    expect(upgrade(tmp()).code).toBe(2);
  }, T);
});

describe('gstack-safe-upgrade — conflicts stop short of installing anything', () => {
  // Running ./setup over a half-merged tree would generate skills out of
  // conflict markers, so the exit code has to be distinguishable from success.
  test('a conflict leaves the merge in progress and the local work intact', () => {
    const { up, inst } = pair();
    const mine = commit(inst, 'SHARED', 'my version\n', 'my edit');
    commit(up, 'SHARED', 'their version\n', 'their edit');

    const r = upgrade(inst);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('conflicts');
    expect(r.stderr).toContain('merge --abort');
    // Work intact, merge still in progress, and no hidden stash.
    expect(git(['merge-base', '--is-ancestor', mine, 'HEAD'], inst).code).toBe(0);
    expect(fs.existsSync(path.join(inst, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(git(['stash', 'list'], inst).stdout).toBe('');

    // And the user can back out to exactly where they were.
    git(['merge', '--abort'], inst);
    expect(git(['rev-parse', 'HEAD'], inst).stdout).toBe(mine);
  }, T);
});

describe('gstack-safe-upgrade — it upgrades from the project, not from a fork', () => {
  // A fork's own main is only as fresh as its last sync. Upgrading from it
  // installs a stale version while reporting success.
  test('when an upstream remote exists it is preferred over origin', () => {
    const project = tmp();
    git(['init', '--initial-branch=main'], project);
    commit(project, 'VERSION', '1.0.0\n', 'initial');

    const fork = tmp();
    git(['clone', project, fork], path.dirname(fork));

    const inst = tmp();
    git(['clone', fork, inst], path.dirname(inst));
    git(['remote', 'add', 'upstream', project], inst);

    // The project moves on; the fork does not.
    const theirs = commit(project, 'THEIRS', 'x\n', 'upstream work');

    const r = upgrade(inst);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('upstream/main');
    expect(git(['merge-base', '--is-ancestor', theirs, 'HEAD'], inst).code).toBe(0);
  }, T);

  test('with only origin, origin is the project and is used', () => {
    const { up, inst } = pair();
    const theirs = commit(up, 'THEIRS', 'x\n', 'upstream work');
    const r = upgrade(inst);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('origin/main');
    expect(git(['merge-base', '--is-ancestor', theirs, 'HEAD'], inst).code).toBe(0);
  }, T);
});

describe('gstack-safe-upgrade — dry run', () => {
  test('reports the plan and changes nothing', () => {
    const { up, inst } = pair();
    commit(up, 'THEIRS', 'x\n', 'upstream work');
    const before = git(['rev-parse', 'HEAD'], inst).stdout;

    const r = upgrade(inst, ['--dry-run']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('dry run');
    expect(git(['rev-parse', 'HEAD'], inst).stdout).toBe(before);
    expect(fs.existsSync(path.join(inst, 'THEIRS'))).toBe(false);
  }, T);
});
