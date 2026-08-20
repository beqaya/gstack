/**
 * gstack-context-census --chains: repeated tool-call chain mining (3C-1).
 * Deterministic synthetic transcript, no real sessions needed.
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const BIN = path.resolve(__dirname, '..', 'bin', 'gstack-context-census');
const T = 30000;

// One assistant message = one JSONL line with a content array of tool_use blocks.
function assistant(blocks: any[]) {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } });
}
function bash(cmd: string) { return { type: 'tool_use', name: 'Bash', input: { command: cmd } }; }
function textBoundary(t: string) { return { type: 'text', text: t }; }

function census(lines: string[], args: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'census-'));
  const f = path.join(dir, 't.jsonl');
  writeFileSync(f, lines.join('\n') + '\n');
  const o = spawnSync(['python', BIN, '--transcript', f, ...args], { env: { ...process.env } });
  rmSync(dir, { recursive: true, force: true });
  return o.stdout.toString();
}

describe('census chain mining', () => {
  test('a repeated git chain is surfaced as a collapse candidate', () => {
    const lines = [
      assistant([bash('git status'), bash('git log -5')]),
      assistant([bash('git status'), bash('git diff')]),
      assistant([bash('git status'), bash('git add x')]),
    ];
    const out = census(lines, ['--chains', '2']);
    expect(out).toContain('Bash:git -> Bash:git');
  }, T);

  test('the cd-prefix does not hide the real verb', () => {
    const lines = [
      assistant([bash('cd "/some/path/TaskMaster (4)/x" && git status')]),
      assistant([bash('cd "/some/path/TaskMaster (4)/x" && git log')]),
    ];
    const out = census(lines, ['--chains', '2']);
    // signs as git, never TaskMaster
    expect(out).not.toContain('TaskMaster');
  }, T);

  test('an assistant text block breaks the chain (a decision was made)', () => {
    const lines = [
      assistant([bash('git status')]),
      assistant([textBoundary('Now I will decide something.')]),
      assistant([bash('git status')]),
    ];
    const out = census(lines, ['--chains', '2']);
    // The two git calls are separated by a decision, so no chain of length 2.
    expect(out).toContain('no chain of length 2 recurs');
  }, T);

  test('a chain seen only once is not reported (needs recurrence)', () => {
    const lines = [assistant([bash('ls'), bash('pwd')])];
    const out = census(lines, ['--chains', '2']);
    expect(out).toContain('no chain of length 2 recurs');
  }, T);
});
