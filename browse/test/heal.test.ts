/**
 * Intent-cache self-healing resolver — re-resolve a stale ref by captured intent.
 */
import { describe, test, expect } from 'bun:test';
import { resolveByIntent, scoreMatch, type SnapshotElement } from '../src/heal';

const els = (...xs: Array<[string, string, string]>): SnapshotElement[] =>
  xs.map(([ref, role, name]) => ({ ref, role, name }));

describe('resolveByIntent', () => {
  test('exact role+name still resolves (ref changed, identity did not)', () => {
    const r = resolveByIntent({ role: 'button', name: 'Submit' },
      els(['@e1', 'link', 'Home'], ['@e7', 'button', 'Submit']));
    expect(r?.ref).toBe('@e7');
    expect(r?.confidence).toBe(1);
  });

  test('a renamed-but-related label heals on token overlap', () => {
    // "Submit" → "Submit order" keeps a shared token.
    const r = resolveByIntent({ role: 'button', name: 'Submit' },
      els(['@e2', 'button', 'Submit order'], ['@e3', 'button', 'Cancel']));
    expect(r?.ref).toBe('@e2');
    expect(r?.confidence).toBeGreaterThan(0.5);
  });

  test('a one-word rename heals when it is the sole element of that role', () => {
    // "Submit" → "Save": no token overlap, but it's the only button.
    const r = resolveByIntent({ role: 'button', name: 'Submit' },
      els(['@e1', 'textbox', 'Email'], ['@e5', 'button', 'Save']));
    expect(r?.ref).toBe('@e5');
    expect(r?.reason).toContain('sole button');
  });

  test('a wrong-role element is NOT chosen even with a matching name', () => {
    // A "Submit" LINK must not heal a "Submit" BUTTON step when a real button exists.
    const r = resolveByIntent({ role: 'button', name: 'Submit' },
      els(['@e1', 'link', 'Submit'], ['@e9', 'button', 'Submit now']));
    expect(r?.ref).toBe('@e9');
  });

  test('an ambiguous one-word rename with several same-role elements refuses to guess', () => {
    const r = resolveByIntent({ role: 'button', name: 'Submit' },
      els(['@e1', 'button', 'Save'], ['@e2', 'button', 'Delete'], ['@e3', 'button', 'Edit']));
    expect(r).toBeNull(); // no token match, not unique → heal is not safe
  });

  test('an empty snapshot yields no heal', () => {
    expect(resolveByIntent({ role: 'button', name: 'Submit' }, [])).toBeNull();
  });
});

describe('scoreMatch', () => {
  test('role match with exact name is 1', () => {
    expect(scoreMatch({ role: 'button', name: 'Go' }, { ref: '@e1', role: 'button', name: 'Go' })).toBe(1);
  });
  test('wrong role caps the score low even on an exact name', () => {
    expect(scoreMatch({ role: 'button', name: 'Go' }, { ref: '@e1', role: 'link', name: 'Go' })).toBeLessThan(0.5);
  });
});
