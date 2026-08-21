/**
 * agentskills.io conformance — emit and validate spec-compliant skill packages.
 *
 * The Agent Skills standard (agentskills.io, open-sourced by Anthropic Dec
 * 2025) is now the interop layer: ~45 clients — every host gstack hand-writes
 * an adapter for (Cursor, Codex, Gemini CLI, Copilot, Factory, Amp, Kiro,
 * OpenCode, Goose) — read the same SKILL.md progressive-disclosure format. The
 * strategic move is to emit ONE spec-compliant artifact and let the adapters
 * shrink to genuine capability deltas.
 *
 * This module is the conformance layer: the checks that say whether a SKILL.md
 * IS standard-compliant. It is the prerequisite for collapsing the pipeline —
 * you cannot drop a per-host adapter until you can prove the canonical emission
 * satisfies the spec every host reads.
 *
 * Spec essentials (agentskills.io): a `SKILL.md` with YAML frontmatter carrying
 * a `name` (the skill's identifier) and a `description` (a discovery blurb the
 * host shows and matches intent against — kept short so it fits a picker), then
 * a Markdown body of instructions. Progressive disclosure = the body is loaded
 * only when the skill activates, so the frontmatter must be self-describing.
 */

export interface Conformance {
  ok: boolean;
  errors: string[];   // block spec-compliance
  warnings: string[]; // allowed but discouraged
  name?: string;
  description?: string;
}

/** The description length the spec treats as a discovery blurb, not a body. */
export const DESCRIPTION_MAX = 1024;

/** Extract the first YAML frontmatter block, or null. */
export function frontmatterOf(md: string): string | null {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return m ? m[1] : null;
}

/** Minimal YAML scalar read for `key: value` and `key: |` block scalars. */
function readScalar(fm: string, key: string): string | null {
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!m) continue;
    let val = m[1].trim();
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      // Block scalar: gather more-indented following lines.
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j]) || lines[j].trim() === '') body.push(lines[j].replace(/^\s+/, ''));
        else break;
      }
      return body.join(' ').trim();
    }
    return val.replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

/**
 * Check a SKILL.md against the agentskills.io spec. Errors block compliance;
 * warnings flag things a host tolerates but that hurt discovery/portability.
 */
export function checkConformance(md: string): Conformance {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fm = frontmatterOf(md);
  if (!fm) {
    return { ok: false, errors: ['no YAML frontmatter block (--- ... ---) at the top'], warnings };
  }
  const name = readScalar(fm, 'name');
  const description = readScalar(fm, 'description');

  if (!name) errors.push('frontmatter is missing required `name`');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    warnings.push(`name "${name}" is not kebab-case a-z0-9- (portable across hosts is safest)`);
  }

  if (!description) errors.push('frontmatter is missing required `description`');
  else if (description.length > DESCRIPTION_MAX) {
    errors.push(`description is ${description.length} chars (> ${DESCRIPTION_MAX}); it is a discovery blurb shown in a picker, not the body`);
  }

  const body = fm ? md.slice(md.indexOf('---', md.indexOf('---') + 3) + 3) : md;
  if (body.trim().length < 20) warnings.push('body is nearly empty — the instructions load on activation, so there should be some');

  return { ok: errors.length === 0, errors, warnings, name: name ?? undefined, description: description ?? undefined };
}

/**
 * Produce a spec-compliant SKILL.md from a name, description, and body — the
 * canonical single-artifact emission. Frontmatter carries only the two spec
 * fields (hosts ignore extras, but a minimal head is the most portable), then
 * the body verbatim. Deterministic: same inputs → byte-identical output, so it
 * is cache-stable and diffable.
 */
export function emitSkill(opts: { name: string; description: string; body: string }): string {
  const desc = opts.description.replace(/\r?\n/g, ' ').trim();
  return `---\nname: ${opts.name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${opts.body.trim()}\n`;
}
