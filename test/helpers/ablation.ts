/**
 * Paired skill-ablation — does a skill actually help?
 *
 * SkillsBench (arXiv 2602.12670) found skills lift pass rates +16.6pp on
 * average but ~19% of skills HURT, and self-generated skills add nothing
 * without an eval gate. gstack's eval harness judges output quality but never
 * measured the counterfactual: run the same task with the target skill
 * installed vs stripped, and score the delta. That delta is the fitness
 * function ACE playbooks, GEPA tuning, and gstack-evolve all optimize against.
 *
 * This module is the PURE scorer + record shape. The paid run driver lives in
 * bin/gstack-skill-ablate (it spends API budget, so it is never imported into
 * the free test path). The skill-off config is produced by
 * hermeticSkillsConfigDir({ excludeSkill }).
 */

export interface AblationTrial {
  passed: boolean;
  costUsd: number;
  tokens: number;
  turns: number;
  durationMs: number;
}

export interface AblationScore {
  skill: string;
  task: string;
  n: number;                 // trials per arm
  withSkillPassRate: number; // 0..1
  withoutPassRate: number;
  passDeltaPp: number;       // percentage points, with − without
  costDeltaUsd: number;      // mean with − mean without (skill's cost overhead)
  verdict: 'helps' | 'neutral' | 'hurts' | 'inconclusive';
  measuredAt: string;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Score one skill against one task from N trials per arm.
 *
 * Verdict thresholds are deliberately conservative because each trial is
 * expensive so N is small: a swing under ±10pp with few trials is called
 * 'neutral' (SkillsBench's own lift was +16.6pp), and fewer than 2 usable
 * trials per arm is 'inconclusive' rather than a number that looks like signal.
 * `hurts` is reported at the SAME threshold as `helps` — a skill that costs
 * budget AND lowers pass rate is the finding this whole exercise exists to catch.
 */
export function scoreAblation(
  skill: string,
  task: string,
  withSkill: AblationTrial[],
  withoutSkill: AblationTrial[],
  measuredAt: string,
): AblationScore {
  const n = Math.min(withSkill.length, withoutSkill.length);
  const withRate = mean(withSkill.map((t) => (t.passed ? 1 : 0)));
  const withoutRate = mean(withoutSkill.map((t) => (t.passed ? 1 : 0)));
  const passDeltaPp = Math.round((withRate - withoutRate) * 1000) / 10;
  const costDeltaUsd = Math.round((mean(withSkill.map((t) => t.costUsd)) - mean(withoutSkill.map((t) => t.costUsd))) * 1e4) / 1e4;

  let verdict: AblationScore['verdict'];
  if (n < 2) verdict = 'inconclusive';
  else if (passDeltaPp >= 10) verdict = 'helps';
  else if (passDeltaPp <= -10) verdict = 'hurts';
  else verdict = 'neutral';

  return { skill, task, n, withSkillPassRate: withRate, withoutPassRate: withoutRate, passDeltaPp, costDeltaUsd, verdict, measuredAt };
}

/** Human-readable one-liner for the health dashboard / CLI. */
export function formatAblation(s: AblationScore): string {
  const sign = s.passDeltaPp > 0 ? '+' : '';
  const cost = s.costDeltaUsd >= 0 ? `+$${s.costDeltaUsd.toFixed(4)}` : `-$${Math.abs(s.costDeltaUsd).toFixed(4)}`;
  const tag = { helps: '✅ HELPS', neutral: '➖ neutral', hurts: '❌ HURTS', inconclusive: '❓ inconclusive' }[s.verdict];
  return `${tag}  ${s.skill}: ${sign}${s.passDeltaPp}pp (${(s.withSkillPassRate * 100).toFixed(0)}% vs ${(s.withoutPassRate * 100).toFixed(0)}%, n=${s.n}), skill cost ${cost}/run`;
}
