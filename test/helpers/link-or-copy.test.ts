import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { linkOrCopySync } from './link-or-copy';

describe('linkOrCopySync', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('dst resolves to src content (directory source)', () => {
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'f.txt'), 'hello');
    const dst = path.join(tmp, 'dst');
    linkOrCopySync(srcDir, dst);
    expect(fs.readFileSync(path.join(dst, 'f.txt'), 'utf-8')).toBe('hello');
  });

  test('relative src resolves against dirname(dst)', () => {
    fs.mkdirSync(path.join(tmp, 'a'));
    fs.writeFileSync(path.join(tmp, 'a', 'g.txt'), 'hi');
    const dst = path.join(tmp, 'b'); // sibling of 'a'
    linkOrCopySync('a', dst);        // relative to dirname(dst) === tmp
    expect(fs.readFileSync(path.join(dst, 'g.txt'), 'utf-8')).toBe('hi');
  });

  test('Windows: missing source is skipped quietly', () => {
    if (process.platform !== 'win32') return; // POSIX intentionally makes a dangling symlink
    const dst = path.join(tmp, 'dst');
    linkOrCopySync(path.join(tmp, 'nope'), dst);
    expect(fs.existsSync(dst)).toBe(false);
  });
});
