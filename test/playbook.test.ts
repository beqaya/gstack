/**
 * ACE learned-playbook store — delta-append, approve gate, dedup, retire.
 */
import { describe, test, expect } from 'bun:test';
import {
  computeBullets, activeBullets, isDuplicate, normalizeText, renderPlaybook,
  type PlaybookEvent,
} from '../lib/gstack-playbook';

const ev = (over: Partial<PlaybookEvent>): PlaybookEvent =>
  ({ event: 'add', id: 'x', skill: 'ship', text: '', source: 'session', date: '2026-08-21T00:00:00Z', ...over });

describe('computeBullets / activeBullets', () => {
  test('a bullet is pending until approved, then active', () => {
    const add = ev({ event: 'add', id: 'a', text: 'lesson one' });
    expect(computeBullets([add])[0].status).toBe('pending');
    expect(activeBullets([add])).toEqual([]);
    expect(activeBullets([add, ev({ event: 'approve', id: 'a' })])[0].id).toBe('a');
  });

  test('retire removes a bullet from active', () => {
    const events = [
      ev({ event: 'add', id: 'a', text: 'one' }),
      ev({ event: 'approve', id: 'a' }),
      ev({ event: 'retire', id: 'a' }),
    ];
    expect(activeBullets(events)).toEqual([]);
    expect(computeBullets(events)[0].status).toBe('retired');
  });

  test('active bullets are ordered by add date', () => {
    const events = [
      ev({ event: 'add', id: 'b', text: 'second', date: '2026-08-21T02:00:00Z' }),
      ev({ event: 'add', id: 'a', text: 'first', date: '2026-08-21T01:00:00Z' }),
      ev({ event: 'approve', id: 'a' }), ev({ event: 'approve', id: 'b' }),
    ];
    expect(activeBullets(events).map((b) => b.id)).toEqual(['a', 'b']);
  });
});

describe('dedup (the Curator rejects restatements)', () => {
  test('near-duplicate text is caught across case/whitespace/punctuation', () => {
    const events = [ev({ event: 'add', id: 'a', text: 'Use forward slashes on Windows' })];
    expect(isDuplicate(events, 'use   forward slashes on windows.')).toBe(true);
    expect(isDuplicate(events, 'a completely different lesson')).toBe(false);
  });

  test('a retired bullet does not block re-adding the same lesson', () => {
    const events = [
      ev({ event: 'add', id: 'a', text: 'reinstate me' }),
      ev({ event: 'retire', id: 'a' }),
    ];
    expect(isDuplicate(events, 'reinstate me')).toBe(false);
  });

  test('normalizeText collapses case, space, trailing punctuation', () => {
    expect(normalizeText('  Hello   World!! ')).toBe('hello world');
  });
});

describe('renderPlaybook', () => {
  test('empty when no bullets', () => {
    expect(renderPlaybook('ship', [])).toBe('');
  });
  test('renders active bullets as a markdown list under a skill heading', () => {
    const out = renderPlaybook('ship', activeBullets([
      ev({ event: 'add', id: 'a', text: 'first lesson' }),
      ev({ event: 'approve', id: 'a' }),
    ]));
    expect(out).toContain('## Learned playbook (/ship)');
    expect(out).toContain('- first lesson');
  });
});
