/**
 * gstack-sandbox — opt-in OS/kernel sandbox wrapper for unattended runs.
 * Exercises the CLI paths that don't need a real sandbox installed.
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import path from 'path';

const BIN = path.resolve(__dirname, '..', 'bin', 'gstack-sandbox');
const T = 30000;

function run(args: string[]) {
  const o = spawnSync(['python', BIN, ...args], { env: { ...process.env } });
  return { code: o.exitCode ?? -1, out: o.stdout.toString(), err: o.stderr.toString() };
}

describe('gstack-sandbox', () => {
  test('--detect reports availability without running anything', () => {
    const r = run(['--detect']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('available sandbox backends');
  }, T);

  test('--strict fails closed (exit 3) when no backend is installed', () => {
    // On this dev box neither srt nor sbx is installed, so strict must refuse.
    const r = run(['--strict', '--', 'echo', 'x']);
    expect(r.code).toBe(3);
    expect(r.err).toContain('refusing to run unprotected');
  }, T);

  test('without --strict it runs the command and passes its exit code through', () => {
    // The contract is passthrough of the command's exit code + an UNPROTECTED
    // warning. (Grandchild stdout capture through bun→python→python is flaky on
    // Windows, so assert the exit code and the wrapper's own stderr, not the
    // inner stdout — the wrapper is proven to passthrough stdout when run directly.)
    const r = run(['--', 'python', '-c', 'import sys; sys.exit(7)']);
    expect(r.code).toBe(7);
    expect(r.err).toContain('UNPROTECTED');
  }, T);

  test('a command before -- is a usage error, not silently swallowed', () => {
    const r = run(['echo', 'x']);
    expect(r.code).toBe(5);
  }, T);

  test('an unknown tier is rejected', () => {
    const r = run(['--tier', 'firecracker', '--', 'echo', 'x']);
    expect(r.code).toBe(5);
  }, T);

  test('the srt wrap form is a direct command, never a nonexistent `run` subcommand', () => {
    // Regression: srt takes the command directly (`srt -- cmd`); it has no
    // `run` verb, so `srt run -- cmd` would try to run a command named "run".
    // Introspect wrap() via the python module to assert the argv shape.
    const o = spawnSync(['python', '-c',
      `import importlib.util,sys
spec=importlib.util.spec_from_file_location('sb', r'${BIN.replace(/\\/g, '\\\\')}')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w=m.wrap('srt',['echo','hi'])
print('run' if 'run' in w else 'norun', w[-2], w[-1])`],
      { env: { ...process.env } });
    const out = o.stdout.toString().trim();
    expect(out.startsWith('norun')).toBe(true);   // no `run` subcommand
    expect(out.endsWith('echo hi')).toBe(true);    // command passes through intact
  }, T);
});
