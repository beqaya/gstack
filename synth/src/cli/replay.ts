import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { executePlan } from "../executor";
import { synthLogDir } from "../paths";
import type { Plan } from "../types";

export async function loadPlanFromTrace(planId: string, dir: string): Promise<Plan> {
  const path = join(dir, `${planId}.jsonl`);
  if (!existsSync(path)) throw new Error(`replay: plan ${planId} not found at ${path}`);
  const lines = readFileSync(path, "utf8").split("\n").filter(l => l.trim().length > 0);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { kind?: string; plan?: Plan };
      if (entry.kind === "plan" && entry.plan) return entry.plan;
    } catch { /* ignore malformed lines */ }
  }
  throw new Error(`replay: no plan entry in trace ${planId}`);
}

export async function cliReplay(planId: string, cwd: string = process.cwd()): Promise<void> {
  const plan = await loadPlanFromTrace(planId, synthLogDir());
  console.log(`Replaying plan ${planId}: ${plan.goal}`);
  const result = await executePlan(plan, { cwd });
  console.log(`Status: ${result.status}`);
  for (const nr of result.node_results) {
    const tag = nr.status === "completed" ? "✓" : "✗";
    console.log(`  ${tag} ${nr.node_id}${nr.error ? ` — ${nr.error}` : ""}`);
  }
}
