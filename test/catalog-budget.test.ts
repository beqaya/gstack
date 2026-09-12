import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillCensus } from './helpers/skill-census';

/**
 * Aggregate discovery-surface budget: the sum of every skill's frontmatter
 * `name` + `description` is what EVERY host loads at discovery, every session.
 *
 * This is the missing enforcement layer over the existing catalog-trim
 * mechanism: `applyCatalogTrim` in scripts/gen-skill-docs.ts (~line 865)
 * shapes each description, and the 160KB per-file warn (~line 1015) covers
 * BODY size — neither caps the aggregate frontmatter the catalog is made of.
 *
 * Import-free by design: parses skills' SKILL.md frontmatter directly. Do not
 * import gen-skill-docs internals here — this test must survive generator
 * refactors.
 *
 * Budget derivation (re-derive it, do not trust the number):
 *   ref     this commit
 *   method  for each authored skill (test/helpers/skill-census.ts
 *           authoredSkills — symlink-deduped, root router excluded) plus the
 *           root router's `_gstack-command` alias frontmatter as one separate
 *           line item, run parseFrontmatter() below and sum
 *           Buffer.byteLength(name) + Buffer.byteLength(description);
 *           token-equivalents = ceil(bytes / 4).
 *   result  57 authored skills incl. the root router alias = 30,322 bytes
 *           = 7,581 token-equivalents (measured 2026-09-12)
 * Ceiling is 7,900 token-equivalents (31,600 bytes), so headroom is ~4%.
 * Dominant skill: delegate at 949 bytes name+description.
 *
 * Ratcheted 1,270 → 7,900 on 2026-09-12, and this is a policy change, not
 * growth. Two things came out at once:
 *
 *   1. parseFrontmatter did not understand the literal block scalar
 *      (`description: |`), which is what --catalog-mode=full emits. The
 *      fallback regex captured the single character `|`, so all 56
 *      descriptions measured 56 bytes in total. The old 1,218 figure was
 *      measured in TRIM mode, where descriptions really are one line.
 *   2. Founder decision, 2026-09-12: full is the committed mode. Trim saved
 *      ~6,300 always-loaded tokens by moving every "Use when asked to…"
 *      trigger into the body, which is read only AFTER a skill is chosen —
 *      so it saved context by making skills unroutable. Measured with
 *      `claude plugin eval`: two of four plan-review skills did not fire on
 *      a user's own phrasing under trim.
 *
 * So the number did not grow 6x; it was never being measured. Treat 7,900 as
 * the real always-loaded discovery surface of full mode, and ratchet it the
 * way this protocol says if a skill is added.
 *
 * Ratcheted 1,150 → 1,270 on 2026-08-27: the authored-skill tree grew 53 → 57
 * since the 1,105 baseline (measured at commit d078622b, v1.62.0.0, 2026-08-12).
 * Tree diff of that baseline against HEAD: added capture-lesson, connect-chrome,
 * delegate, observe, parity, run-supervisor, scratch, session-lock,
 * verify-outcome (the enforcement / guards / observability skills, authored on
 * branches Aug 4–16 and landed on main after the baseline); removed the 5 iOS
 * skills plus open-gstack-browser (retired; connect-chrome is its replacement,
 * so that pair is a rename, not net growth). Every entry is under the 260-byte
 * per-skill cap; the growth is more skills, not fatter blurbs, so the honest
 * fix is a ceiling ratchet, not trimming legitimate descriptions.
 */
const CATALOG_BUDGET_TOKEN_EQUIVALENTS = 7_900;

// Largest today: delegate at 949 bytes. In full mode a description carries its
// trigger phrases, so the old 260-byte cap was a trim-mode number; it measured
// the lead sentence alone. A description past 990 bytes is a body paragraph
// that drifted into the catalog, and every host pays for it every session.
const PER_SKILL_BYTE_CAP = 990;

const RATCHET_PROTOCOL =
  'Adding a skill? Re-measure with: bun test test/catalog-budget.test.ts ' +
  '(the failure prints the new total). Update CATALOG_BUDGET_TOKEN_EQUIVALENTS ' +
  'AND the derivation comment (ref/date/value/which skill moved it) in the ' +
  'SAME commit. Growing an existing description? Trim it instead — the ' +
  'catalog is what every host loads at discovery, every session.';

const ROOT = join(import.meta.dir, '..');

function parseFrontmatter(body: string): { name: string; description: string } {
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
  // Block scalar, folded (`>`/`>-`) OR literal (`|`/`|-`), with two-space
  // indented continuation lines, falling back to a single-line description.
  //
  // The literal form was missing until 2026-09-12, and it is the form
  // `--catalog-mode=full` emits — this fork's canonical resting state. Without
  // it the fallback regex captured the single character `|`, so every
  // description measured one byte: 56 bytes total against a real 29,433, and
  // this budget reported green at 5.8x its own ceiling. A cap that cannot see
  // what it caps is worse than no cap, because it is believed.
  const block = body.match(/^description:\s*[>|]-?\r?\n((?:  .*\r?\n)+)/m)?.[1];
  const description = block
    ? block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' ')
    : body.match(/^description:\s*(?![>|]-?\s*$)(.+)$/m)?.[1]?.trim() ?? '';
  return { name, description };
}

interface CatalogEntry {
  skill: string;
  name: string;
  description: string;
  bytes: number;
}

function catalogEntries(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const skill of skillCensus(ROOT).authoredSkills) {
    const body = readFileSync(join(ROOT, skill, 'SKILL.md'), 'utf8');
    const { name, description } = parseFrontmatter(body);
    entries.push({
      skill,
      name,
      description,
      bytes: Buffer.byteLength(name) + Buffer.byteLength(description),
    });
  }
  // The root SKILL.md is a router, registered by setup as the
  // `_gstack-command` alias — not an authored skill, but its frontmatter
  // still ships in the catalog, so it counts as one line item.
  const router = parseFrontmatter(readFileSync(join(ROOT, 'SKILL.md'), 'utf8'));
  if (router.name && router.description) {
    entries.push({
      skill: '(root router)',
      name: router.name,
      description: router.description,
      bytes: Buffer.byteLength(router.name) + Buffer.byteLength(router.description),
    });
  }
  return entries;
}

describe('catalog discovery-surface budget', () => {
  test(`aggregate frontmatter stays within ${CATALOG_BUDGET_TOKEN_EQUIVALENTS} token-equivalents`, () => {
    const entries = catalogEntries();
    const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
    const estimatedTokens = Math.ceil(totalBytes / 4);
    const delta = estimatedTokens - CATALOG_BUDGET_TOKEN_EQUIVALENTS;
    expect(
      estimatedTokens,
      `Catalog is ${estimatedTokens} token-equivalents (${totalBytes} bytes), ` +
        `${delta} over the ${CATALOG_BUDGET_TOKEN_EQUIVALENTS} budget. ${RATCHET_PROTOCOL}`
    ).toBeLessThanOrEqual(CATALOG_BUDGET_TOKEN_EQUIVALENTS);
  });

  test(`every skill's name + description stays under ${PER_SKILL_BYTE_CAP} bytes`, () => {
    for (const entry of catalogEntries()) {
      expect(
        entry.bytes,
        `${entry.skill}: name + description is ${entry.bytes} bytes, ` +
          `${entry.bytes - PER_SKILL_BYTE_CAP} over the ${PER_SKILL_BYTE_CAP}-byte ` +
          `per-skill cap. ${RATCHET_PROTOCOL}`
      ).toBeLessThanOrEqual(PER_SKILL_BYTE_CAP);
    }
  });

  test('every skill has a non-empty description', () => {
    for (const entry of catalogEntries()) {
      expect(entry.description, `${entry.skill}: empty or missing frontmatter description`).not.toBe('');
    }
  });
});
