import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

function skillTemplates(): string[] {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'node_modules')
    .map(d => path.join(ROOT, d.name, 'SKILL.md.tmpl'))
    .filter(p => fs.existsSync(p));
}

/** The description block a host actually receives, joined as one line. */
function description(tmpl: string): string {
  const src = fs.readFileSync(tmpl, 'utf8');
  const block = src.match(/^description:[ ]*\|[ ]*\r?\n((?:[ ]{2}.*\r?\n)+)/m);
  if (block) return block[1].split(/\r?\n/).map(l => l.trim()).join(' ').trim();
  const inline = src.match(/^description:[ ]*(.+)$/m);
  return inline ? inline[1].trim() : '';
}

describe('skill descriptions fit every host', () => {
  // v1.61.0.0 introduced a hard cap for the OpenAI Codex CLI. /parity was
  // 1324 chars, and the generator aborts the WHOLE host on one violation —
  // `./setup` reported "1 host(s) failed: codex" and produced no .agents/
  // skills at all. One oversized description took out an entire host.
  const CODEX_MAX = 1024;

  for (const tmpl of skillTemplates()) {
    const name = path.basename(path.dirname(tmpl));
    test(`${name} description is within the Codex limit`, () => {
      const len = description(tmpl).length;
      expect(len).toBeLessThanOrEqual(CODEX_MAX);
    });
  }
});

describe('generated output is byte-stable across regenerations', () => {
  // Every model overlay was stored with CRLF while git stored LF. The
  // generator injects overlay prose verbatim, so each regeneration rewrote
  // 50+ SKILL.md files with CR bytes git did not have. `git status` then
  // showed 50 modified files whose `git diff` was empty — which blocked the
  // upgrade guard on pure noise and hid the two files that HAD really changed.
  const carriesCR = (p: string) => fs.readFileSync(p).includes(0x0d);

  test('model overlays contain no carriage returns', () => {
    const dir = path.join(ROOT, 'model-overlays');
    const offenders = fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .filter(f => carriesCR(path.join(dir, f)));
    expect(offenders).toEqual([]);
  });

  test('generated SKILL.md files contain no carriage returns', () => {
    const offenders = skillTemplates()
      .map(t => path.join(path.dirname(t), 'SKILL.md'))
      .filter(p => fs.existsSync(p) && carriesCR(p))
      .map(p => path.relative(ROOT, p));
    expect(offenders).toEqual([]);
  });
});
