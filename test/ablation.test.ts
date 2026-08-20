/**
 * Paired skill-ablation — scorer logic + the skill-off seeding mechanism.
 * No paid runs: the scorer is pure, and the seeding test checks that the
 * without-<skill> config dir omits exactly the target and nothing else.
 */
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { scoreAblation, type AblationTrial } from './helpers/ablation';

const trial = (passed: boolean, costUsd = 0.02): AblationTrial =>
  ({ passed, costUsd, tokens: 1000, turns: 3, durationMs: 5000 });

describe('scoreAblation', () => {
  test('a skill that lifts pass rate ≥10pp is HELPS', () => {
    const s = scoreAblation('x', 't',
      [trial(true), trial(true), trial(true)],   // 100%
      [trial(false), trial(true), trial(false)], // 33%
      '2026-08-20T00:00:00Z');
    expect(s.verdict).toBe('helps');
    expect(s.passDeltaPp).toBeCloseTo(66.7, 0);
  });

  test('a skill that lowers pass rate ≥10pp is HURTS (the finding we exist to catch)', () => {
    const s = scoreAblation('x', 't',
      [trial(false), trial(false)], // 0% with
      [trial(true), trial(true)],   // 100% without
      '2026-08-20T00:00:00Z');
    expect(s.verdict).toBe('hurts');
    expect(s.passDeltaPp).toBe(-100);
  });

  test('a swing under ±10pp is neutral', () => {
    const s = scoreAblation('x', 't',
      [trial(true), trial(true), trial(true), trial(true), trial(true), trial(false), trial(false), trial(false), trial(false), trial(false)], // 50%
      [trial(true), trial(true), trial(true), trial(true), trial(true), trial(false), trial(false), trial(false), trial(false), trial(false)], // 50%
      '2026-08-20T00:00:00Z');
    expect(s.verdict).toBe('neutral');
  });

  test('fewer than 2 trials per arm is inconclusive, never a fake signal', () => {
    const s = scoreAblation('x', 't', [trial(true)], [trial(false)], '2026-08-20T00:00:00Z');
    expect(s.verdict).toBe('inconclusive');
  });

  test('cost delta captures the skill overhead sign', () => {
    const s = scoreAblation('x', 't',
      [trial(true, 0.05), trial(true, 0.05)],
      [trial(true, 0.02), trial(true, 0.02)],
      '2026-08-20T00:00:00Z');
    expect(s.costDeltaUsd).toBeCloseTo(0.03, 4);
  });
});

describe('skill-off seeding (hermeticSkillsConfigDir excludeSkill)', () => {
  test('the without-<skill> config omits exactly the target and keeps the rest', async () => {
    process.env.EVALS_HERMETIC = '1';
    const { hermeticSkillsConfigDir } = await import('./helpers/hermetic-env');
    const withAll = hermeticSkillsConfigDir();
    const without = hermeticSkillsConfigDir({ excludeSkill: 'office-hours' });
    expect(without).not.toBe(withAll); // distinct dir, not the cached one

    const list = (dir: string) => fs.readdirSync(path.join(dir, 'skills')).sort();
    const all = list(withAll);
    const minus = list(without);

    // office-hours' registry name is its own dir name (frontmatter name matches).
    expect(all).toContain('office-hours');
    expect(minus).not.toContain('office-hours');
    // Every OTHER skill still present — the diff is exactly one entry.
    expect(all.filter((s) => s !== 'office-hours')).toEqual(minus);
  });
});
