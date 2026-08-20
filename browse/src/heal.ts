/**
 * Intent-cache self-healing for codified browser-skills.
 *
 * A codified step caches a locator (an @ref, valid only for the snapshot that
 * produced it). When the page changes — a button renamed "Submit" to "Save",
 * a row reordered — the cached ref goes stale and replay aborts mid-flow. The
 * Agentic Compilation refinement (arXiv 2604.09718) is to cache each step's
 * semantic INTENT beside the locator and, on failure, re-resolve only the
 * broken step against a fresh snapshot (lazy replanning) — then write the new
 * locator back so the heal is paid once, not every run.
 *
 * This module is the pure resolver: given a step's captured intent (the
 * element's role + accessible name at codify time) and the live snapshot's
 * elements, pick the current ref that still means the same thing. Deterministic
 * and testable; no browser, no model call — the accessibility identity is
 * usually enough, which is why the heal is cheap.
 */

export interface StepIntent {
  /** ARIA role captured at codify time, e.g. "button", "textbox", "link". */
  role: string;
  /** Accessible name captured at codify time, e.g. "Submit", "Email". */
  name: string;
}

export interface SnapshotElement {
  ref: string;   // @e3
  role: string;
  name: string;
}

export interface HealResult {
  ref: string;
  confidence: number; // 0..1
  reason: string;
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Token-overlap (Jaccard) of two accessible names. */
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (!ta.size && !tb.size) return 1;
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Score how well a live element still matches the captured intent.
 *
 * Role is the strong signal — a healed "button" must not become a "link", so
 * a role mismatch caps the score low. Within the right role, name similarity
 * ranks candidates: exact name is 1.0, a renamed-but-related label
 * ("Submit" → "Save & submit") scores on token overlap, and a synonymous
 * single-word rename ("Submit" → "Save") falls back to "the only element of
 * this role", handled by the caller when there is exactly one.
 */
export function scoreMatch(intent: StepIntent, el: SnapshotElement): number {
  const roleOk = norm(intent.role) === norm(el.role);
  const sim = nameSimilarity(intent.name, el.name);
  if (!roleOk) return sim * 0.3;        // wrong role: only a strong name match survives, weakly
  if (norm(intent.name) === norm(el.name)) return 1;
  // Right role, name drifted: a shared token climbs toward 1, but ZERO overlap
  // scores 0.3 (below the 0.5 heal floor) on purpose — a one-word rename with
  // no shared token must NOT auto-heal on role alone; it only heals when it is
  // the sole element of that role (the uniqueness fallback in resolveByIntent).
  return 0.3 + sim * 0.7;
}

/**
 * Re-resolve a stale step to a current ref by its captured intent.
 *
 * Returns the best-scoring element above `minConfidence`. A special case:
 * when the name drifted beyond recognition (a one-word rename) BUT exactly one
 * element of the captured role exists, that lone element is the heal — this is
 * the "Submit → Save" case the token score can't catch, disambiguated by
 * uniqueness rather than by guessing.
 */
export function resolveByIntent(
  intent: StepIntent,
  elements: SnapshotElement[],
  minConfidence = 0.5,
): HealResult | null {
  if (!elements.length) return null;
  const scored = elements
    .map((el) => ({ el, score: scoreMatch(intent, el) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score >= minConfidence) {
    const reason = norm(intent.name) === norm(best.el.name)
      ? 'exact name + role match'
      : `role match, name drifted ${JSON.stringify(intent.name)}→${JSON.stringify(best.el.name)}`;
    return { ref: best.el.ref, confidence: Math.round(best.score * 100) / 100, reason };
  }

  // Uniqueness fallback: one element of the captured role → that's the heal.
  const sameRole = elements.filter((e) => norm(e.role) === norm(intent.role));
  if (sameRole.length === 1) {
    return { ref: sameRole[0].ref, confidence: 0.5,
      reason: `sole ${intent.role} on the page (name ${JSON.stringify(intent.name)}→${JSON.stringify(sameRole[0].name)})` };
  }
  return null;
}
