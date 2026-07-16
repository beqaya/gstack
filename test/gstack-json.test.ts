import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as path from 'path';

const BIN = path.join(import.meta.dir, '..', 'bin', 'gstack-json');

// Invoke via `bun <script>` (Windows CreateProcess can't dispatch the shebang).
function run(args: string[], input?: string) {
  return spawnSync('bun', [BIN, ...args], { input, encoding: 'utf-8' });
}

describe('gstack-json', () => {
  test('extracts a dotted path from stdin', () => {
    const r = run(['.a.b'], '{"a":{"b":"x"}}');
    expect(r.stdout.trim()).toBe('x');
    expect(r.status).toBe(0);
  });

  test('extracts through a bracket index', () => {
    const r = run(['.result.tools[0].name'], '{"result":{"tools":[{"name":"sources_add"}]}}');
    expect(r.stdout.trim()).toBe('sources_add');
  });

  test('missing field yields empty string, exit 0 (jq // empty parity)', () => {
    const r = run(['.missing'], '{}');
    expect(r.stdout).toBe('\n');
    expect(r.status).toBe(0);
  });

  test('null field yields empty string', () => {
    const r = run(['.a'], '{"a":null}');
    expect(r.stdout).toBe('\n');
  });

  test('object value is emitted as JSON', () => {
    const r = run(['.a'], '{"a":{"k":1}}');
    expect(r.stdout.trim()).toBe('{"k":1}');
  });

  test('invalid JSON exits non-zero with no stdout', () => {
    const r = run(['.a'], 'not json');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });

  test('reads from a file argument', () => {
    const pkg = path.join(import.meta.dir, '..', 'package.json');
    const r = run(['.name', pkg]);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });
});
