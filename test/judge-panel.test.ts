/**
 * Panel-of-judges aggregator (PoLL). Pure functions only — no paid calls.
 */
import { describe, test, expect } from 'bun:test';
import { median, aggregatePanel } from './helpers/llm-judge';

describe('median', () => {
  test('odd count returns the middle', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  test('even count averages the two middles', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  test('empty is 0', () => {
    expect(median([])).toBe(0);
  });
});

describe('aggregatePanel', () => {
  test('an outlier judge cannot drag the verdict (median, not mean)', () => {
    // Two judges say 5, one says 1. Mean would be 3.67; median holds at 5.
    const r = aggregatePanel([5, 5, 1], ['a', 'b', 'c']);
    expect(r.score).toBe(5);
  });

  test('agreeing judges produce low disagreement and no flag', () => {
    const r = aggregatePanel([4, 4, 5], ['a', 'b', 'c']);
    expect(r.disagreement).toBe(1);
    expect(r.flagged).toBe(false);
  });

  test('a wide spread flags the item for escalation', () => {
    const r = aggregatePanel([1, 3, 5], ['a', 'b', 'c'], 2);
    expect(r.disagreement).toBe(4);
    expect(r.flagged).toBe(true); // 4 > tolerance 2 → escalate to frontier judge/human
  });

  test('records which models actually voted', () => {
    const r = aggregatePanel([3, 4], ['haiku', 'sonnet']);
    expect(r.models).toEqual(['haiku', 'sonnet']);
    expect(r.votes).toEqual([3, 4]);
  });
});
