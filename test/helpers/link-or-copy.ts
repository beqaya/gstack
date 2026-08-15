import * as fs from 'fs';
import * as path from 'path';

/**
 * Test-only mirror of setup's `_link_or_copy`: symlink on POSIX, copy on
 * Windows (where symlinkSync EPERMs without Developer Mode). `src` is resolved
 * the way a symlink would be — relative to dirname(dst) when not absolute. A
 * missing resolved source is skipped quietly (matches _link_or_copy). Copy
 * errors are NOT swallowed.
 */
export function linkOrCopySync(src: string, dst: string): void {
  if (process.platform !== 'win32') {
    fs.symlinkSync(src, dst);
    return;
  }
  const resolvedSrc = path.isAbsolute(src) ? src : path.resolve(path.dirname(dst), src);
  if (!fs.existsSync(resolvedSrc)) return;
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(resolvedSrc, dst, { recursive: true });
}
