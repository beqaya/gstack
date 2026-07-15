import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const HELPER = path.join(ROOT, 'test', 'helpers', 'link-or-copy.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); }
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no raw fs.symlinkSync in tests (route through linkOrCopySync)', () => {
  test('every test file uses the helper, not raw symlinkSync', () => {
    const files = [
      ...walk(path.join(ROOT, 'test')),
      ...walk(path.join(ROOT, 'browse', 'test')),
    ].filter((f) => path.resolve(f) !== path.resolve(HELPER));

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      // Ignore comment lines; flag any `symlinkSync(` call.
      const hit = src.split('\n').some((line) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return false;
        return /\bsymlinkSync\s*\(/.test(line);
      });
      if (hit) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});
