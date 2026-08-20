/**
 * ACE-style learned playbooks — a skill that accumulates lessons without rotting.
 *
 * Agentic Context Engineering (arXiv 2510.04618) evolves a skill's context as
 * an itemized playbook grown by INCREMENTAL DELTA UPDATES — never a rewrite.
 * That is deliberate: it solves the two documented failure modes of
 * self-updating prompts. Brevity bias (a rewrite compresses away hard-won
 * detail) and context collapse (iterative rewriting erodes the doc). So this
 * store only ever appends bullets or retires them by id; there is no edit and
 * no rewrite path, by design.
 *
 * Roles (ACE): a session that hits a lesson is the Generator; whoever proposes
 * the bullet is the Reflector; the approval gate here is the Curator (Devin's
 * Knowledge pattern: suggest → approve → auto-recall). A pending bullet is
 * invisible to skills until approved, so a bad auto-proposal never leaks in.
 */
import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';

export type PlaybookStatus = 'pending' | 'active' | 'retired';

export interface PlaybookEvent {
  event: 'add' | 'approve' | 'retire';
  id: string;
  skill: string;
  text?: string;     // on add
  source?: string;   // on add: session / user / capture-lesson
  date: string;
}

export interface PlaybookBullet {
  id: string;
  skill: string;
  text: string;
  source: string;
  status: PlaybookStatus;
  added: string;
}

export function playbookPath(skill: string, gstackHome?: string): string {
  const home = gstackHome || process.env.GSTACK_HOME || join(homedir(), '.gstack');
  return join(home, 'playbooks', `${skill}.jsonl`);
}

export function readEvents(path: string): PlaybookEvent[] {
  if (!existsSync(path)) return [];
  const out: PlaybookEvent[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  return out;
}

export function appendEvent(path: string, ev: PlaybookEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(ev) + '\n');
}

/** Fold the event log into current bullets. add→pending, approve→active, retire→retired. */
export function computeBullets(events: PlaybookEvent[]): PlaybookBullet[] {
  const byId = new Map<string, PlaybookBullet>();
  for (const e of events) {
    if (e.event === 'add') {
      byId.set(e.id, { id: e.id, skill: e.skill, text: e.text ?? '', source: e.source ?? 'unknown', status: 'pending', added: e.date });
    } else if (e.event === 'approve') {
      const b = byId.get(e.id); if (b && b.status === 'pending') b.status = 'active';
    } else if (e.event === 'retire') {
      const b = byId.get(e.id); if (b) b.status = 'retired';
    }
  }
  return [...byId.values()];
}

export function activeBullets(events: PlaybookEvent[]): PlaybookBullet[] {
  return computeBullets(events).filter((b) => b.status === 'active')
    .sort((a, b) => (a.added < b.added ? -1 : 1));
}

/** Normalize for dedup: lowercase, collapse whitespace, strip trailing punctuation. */
export function normalizeText(t: string): string {
  return t.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?,;:]+$/, '').trim();
}

/**
 * Is `text` a near-duplicate of an existing non-retired bullet? Dedup is the
 * Curator's first job — ACE's whole point is that the playbook grows in
 * distinct items, not in restatements of the same lesson.
 */
export function isDuplicate(events: PlaybookEvent[], text: string): boolean {
  const norm = normalizeText(text);
  return computeBullets(events).some((b) => b.status !== 'retired' && normalizeText(b.text) === norm);
}

/** Render active bullets as the markdown block a skill injects at runtime. */
export function renderPlaybook(skill: string, bullets: PlaybookBullet[]): string {
  if (!bullets.length) return '';
  const lines = bullets.map((b) => `- ${b.text}`);
  return `## Learned playbook (/${skill})\n\n`
    + `Lessons this skill accumulated from past runs. Treat each as a standing `
    + `rule for this run unless it plainly conflicts with the user's request.\n\n`
    + lines.join('\n');
}
