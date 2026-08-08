import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const RC = path.join(ROOT, 'bin', 'gstack-risk-classify');
const PY = process.env.GSTACK_PY || 'python';

function classify(action: string) {
  const o = spawnSync([PY, RC, '--action', action]);
  return o.stdout.toString().trim();
}

describe('gstack-risk-classify', () => {
  test('elevated actions are caught', () => {
    expect(classify('git push origin main')).toBe('elevated');
    expect(classify('gh workflow run db-migrate.yml -f mode=apply')).toBe('elevated');
    expect(classify('rm -rf build')).toBe('elevated');
    expect(classify('edit ~/.claude/settings.json')).toBe('elevated');
  });

  test('routine actions are not inflated', () => {
    expect(classify('npx tsc --noEmit')).toBe('routine');
    expect(classify('bun test test/foo.test.ts')).toBe('routine');
    expect(classify('read server/app.ts')).toBe('routine');
  });

  test('classification is case-insensitive', () => {
    expect(classify('GIT PUSH origin main')).toBe('elevated');
  });

  test('newly covered dangerous actions are elevated, not routine', () => {
    expect(classify('edit .env')).toBe('elevated');
    expect(classify('write client.pem')).toBe('elevated');
    expect(classify('update ~/.ssh/config')).toBe('elevated');
    expect(classify('edit .github/workflows/test.yml')).toBe('elevated');
    expect(classify('gcloud projects delete lezam')).toBe('elevated');
    expect(classify('sudo rm /etc/hosts')).toBe('elevated');
    expect(classify('npm publish')).toBe('elevated');
  });
});

describe('enforcement-code changes are elevated', () => {
  test('editing the runtime own enforcement files is elevated', () => {
    expect(classify('edit bin/gstack-run to add a resolve subcommand')).toBe('elevated');
    expect(classify('modify bin/gstack-budget-guard')).toBe('elevated');
    expect(classify('update the risk-classify table')).toBe('elevated');
    expect(classify('patch the generated-guard hook')).toBe('elevated');
  });

  test('merely INVOKING the runtime stays routine', () => {
    // The supervisor calls these constantly; if invocation were elevated,
    // every loop step would demand an independent verifier and the tier would
    // stop meaning anything.
    expect(classify('~/.claude/skills/gstack/bin/gstack-run done --run x --item y')).toBe('routine');
    expect(classify('~/.claude/skills/gstack/bin/gstack-run claim --run x --worker w')).toBe('routine');
    expect(classify('write a design doc')).toBe('routine');
  });
});
