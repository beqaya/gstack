/**
 * agentskills.io conformance checker + canonical emitter.
 */
import { describe, test, expect } from 'bun:test';
import { checkConformance, emitSkill, frontmatterOf, DESCRIPTION_MAX } from '../lib/gstack-skill-emit';

describe('checkConformance', () => {
  test('a well-formed SKILL.md is conformant', () => {
    const md = '---\nname: ship\ndescription: Ship workflow — tests, review, PR.\n---\n\n# /ship\nDoes the thing.\n';
    const r = checkConformance(md);
    expect(r.ok).toBe(true);
    expect(r.name).toBe('ship');
  });

  test('missing frontmatter is a hard error', () => {
    expect(checkConformance('# just a body\n').ok).toBe(false);
  });

  test('missing name or description blocks compliance', () => {
    expect(checkConformance('---\ndescription: x has enough\n---\nbody here now\n').errors.join()).toContain('name');
    expect(checkConformance('---\nname: ship\n---\nbody here now\n').errors.join()).toContain('description');
  });

  test('an over-long description is rejected (it is a picker blurb, not the body)', () => {
    const long = 'x'.repeat(DESCRIPTION_MAX + 1);
    const md = `---\nname: ship\ndescription: ${long}\n---\n\nbody with enough content here\n`;
    const r = checkConformance(md);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('discovery blurb');
  });

  test('a block-scalar description is read correctly', () => {
    const md = '---\nname: ship\ndescription: |\n  A multi-line\n  description block.\n---\n\nbody with enough content here now\n';
    const r = checkConformance(md);
    expect(r.ok).toBe(true);
    expect(r.description).toContain('multi-line');
  });

  test('a non-kebab name warns but does not block', () => {
    const md = '---\nname: Ship_It\ndescription: valid description text\n---\n\nbody with enough content here now\n';
    const r = checkConformance(md);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toContain('kebab');
  });
});

describe('emitSkill', () => {
  test('produces a conformant, deterministic artifact', () => {
    const a = emitSkill({ name: 'x', description: 'a\nb', body: '# body\ntext' });
    const b = emitSkill({ name: 'x', description: 'a\nb', body: '# body\ntext' });
    expect(a).toBe(b); // deterministic → cache-stable
    expect(checkConformance(a).ok).toBe(true);
    expect(frontmatterOf(a)).toContain('name: x');
  });
});
