import type { Plan } from "../types";
import { synthesize } from "../engine/synthesize";
import { callLlm } from "../engine/llm-caller";
import { executePlan } from "../executor";
import { createTraceLogger } from "../trace";
import { synthLogDir } from "../paths";
import { spawnSync } from "node:child_process";

export interface SynthCliOpts {
  goal: string;
  mode: "plan-only" | "execute";
  model?: string;
}

export function renderPlanForUser(plan: Plan): string {
  const lines = [
    `Plan ${plan.plan_id}  (goal: ${plan.goal})`,
    plan.estimated_cost_usd != null ? `Estimated cost: $${plan.estimated_cost_usd.toFixed(3)}` : "",
    "",
    "Nodes:",
  ];
  for (const n of plan.nodes) {
    const args = JSON.stringify(n.primitive).slice(0, 100);
    lines.push(`  ${n.id} [${n.primitive.op}] ${n.label ? "— " + n.label : ""}`);
    lines.push(`    args: ${args}`);
    if (n.depends_on.length > 0) lines.push(`    depends_on: ${n.depends_on.join(", ")}`);
  }
  return lines.filter(Boolean).join("\n");
}

function gatherContext(cwd: string): { branch: string; recentCommits: string[] } {
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
  const log = spawnSync("git", ["log", "--oneline", "-n", "5"], { cwd, encoding: "utf8" }).stdout.trim();
  const recentCommits = log ? log.split("\n") : [];
  return { branch: branch || "(unknown)", recentCommits };
}

export async function cliSynth(opts: SynthCliOpts, cwd: string = process.cwd()): Promise<void> {
  const projectContext = gatherContext(cwd);
  const result = await synthesize({
    goal: opts.goal,
    projectContext,
    llmCall: (prompt) => callLlm(prompt, { model: opts.model ?? "claude-sonnet-4-6" }),
  });

  if (!result.ok) {
    console.error("Synthesis failed:");
    for (const e of result.errors) console.error("  -", e);
    process.exit(1);
  }

  const rendered = renderPlanForUser(result.plan);
  console.log(rendered);

  if (opts.mode === "plan-only") return;

  const logger = createTraceLogger(result.plan.plan_id, synthLogDir());
  await logger.writePlan(result.plan);
  const execResult = await executePlan(result.plan, { cwd });
  for (const nr of execResult.node_results) await logger.writeNodeResult(nr);
  await logger.writeFinal(execResult.status);
  await logger.close();

  console.log("");
  console.log(`Execution: ${execResult.status}`);
  for (const nr of execResult.node_results) {
    const tag = nr.status === "completed" ? "✓" : "✗";
    console.log(`  ${tag} ${nr.node_id}${nr.error ? ` — ${nr.error}` : ""}`);
  }
}
