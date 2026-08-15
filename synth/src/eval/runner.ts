import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { synthesize, type SynthesizeResult } from "../engine/synthesize";
import type { Plan, Primitive } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOALS_PATH = join(HERE, "goals.json");

export interface EvalGoal {
  id: string;
  goal: string;
  expected_primitives: string[];
  min_nodes: number;
  max_nodes: number;
  requires_runtime?: boolean;
}

export interface EvalResult {
  ok: boolean;
  reasons: string[];
}

export function evaluatePlan(plan: Plan, goal: EvalGoal): EvalResult {
  const reasons: string[] = [];
  if (plan.nodes.length < goal.min_nodes) reasons.push(`plan has ${plan.nodes.length} nodes (< min ${goal.min_nodes})`);
  if (plan.nodes.length > goal.max_nodes) reasons.push(`plan has ${plan.nodes.length} nodes (> max ${goal.max_nodes})`);
  const opsUsed = new Set(plan.nodes.map(n => n.primitive.op));
  for (const expected of goal.expected_primitives) {
    if (!opsUsed.has(expected as Primitive["op"])) reasons.push(`missing expected primitive: ${expected}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export async function loadGoals(): Promise<EvalGoal[]> {
  const raw = await readFile(GOALS_PATH, "utf8");
  return (JSON.parse(raw) as { goals: EvalGoal[] }).goals;
}

export async function runEval(opts: {
  llmCall: (prompt: string) => Promise<string>;
  projectContext: { branch: string; recentCommits: string[] };
}): Promise<{ id: string; ok: boolean; reasons: string[] }[]> {
  const goals = await loadGoals();
  const results: { id: string; ok: boolean; reasons: string[] }[] = [];
  for (const g of goals) {
    if (g.requires_runtime) {
      results.push({ id: g.id, ok: true, reasons: ["skipped — requires runtime (Spec 2)"] });
      continue;
    }
    const sr: SynthesizeResult = await synthesize({
      goal: g.goal, projectContext: opts.projectContext, llmCall: opts.llmCall,
    });
    if (!sr.ok) {
      results.push({ id: g.id, ok: false, reasons: sr.errors });
      continue;
    }
    const r = evaluatePlan(sr.plan, g);
    results.push({ id: g.id, ok: r.ok, reasons: r.reasons });
  }
  return results;
}
