import { buildSynthesisPrompt, type ProjectContext } from "./prompt";
import { parsePlanResponse } from "./parser";
import { validatePlan } from "../validator";
import type { Plan } from "../types";

export interface SynthesizeOpts {
  goal: string;
  projectContext: ProjectContext;
  llmCall: (prompt: string) => Promise<string>;
  maxNodes?: number;
  maxDepth?: number;
}

export type SynthesizeResult =
  | { ok: true; plan: Plan }
  | { ok: false; errors: string[] };

export async function synthesize(opts: SynthesizeOpts): Promise<SynthesizeResult> {
  const prompt = buildSynthesisPrompt({
    goal: opts.goal,
    projectContext: opts.projectContext,
    maxNodes: opts.maxNodes ?? 50,
    maxDepth: opts.maxDepth ?? 6,
  });

  const raw = await opts.llmCall(prompt);

  let plan: Plan;
  try {
    plan = parsePlanResponse(raw);
  } catch (err) {
    return { ok: false, errors: [`parse error: ${(err as Error).message}`] };
  }

  const v = validatePlan(plan);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, plan };
}
