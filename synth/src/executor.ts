import { runReadFile } from "./primitives/read-file";
import { runGrep } from "./primitives/grep";
import { runGitLog } from "./primitives/git-log";
import { runGitDiff } from "./primitives/git-diff";
import { runHealthScore } from "./primitives/health-score";
import { runProdQuery } from "./primitives/prod-query";
import { runParallel } from "./primitives/parallel";
import { runSequential } from "./primitives/sequential";
import type { ExecutionResult, NodeResult, Plan, PlanNode, PrimitiveOutput } from "./types";

export interface ExecutorCtx {
  cwd: string;
  runner?: (node: PlanNode, ctx: ExecutorCtx, outputs: Record<string, PrimitiveOutput>) => Promise<PrimitiveOutput>;
}

export async function executePlan(plan: Plan, ctx: ExecutorCtx): Promise<ExecutionResult> {
  const started_at = new Date().toISOString();
  const sorted = topoSort(plan.nodes);
  const outputs: Record<string, PrimitiveOutput> = {};
  const node_results: NodeResult[] = [];

  let status: ExecutionResult["status"] = "completed";

  for (const node of sorted) {
    const node_started = new Date().toISOString();
    try {
      const out = ctx.runner
        ? await ctx.runner(node, ctx, outputs)
        : await defaultNodeRunner(node, ctx, outputs);
      outputs[node.id] = out;
      node_results.push({
        node_id: node.id, status: "completed",
        started_at: node_started, ended_at: new Date().toISOString(), output: out,
      });
    } catch (err) {
      node_results.push({
        node_id: node.id, status: "failed",
        started_at: node_started, ended_at: new Date().toISOString(),
        error: (err as Error)?.message ?? String(err),
      });
      status = "failed";
      break;
    }
  }

  return {
    plan_id: plan.plan_id,
    started_at,
    ended_at: new Date().toISOString(),
    status,
    outputs,
    node_results,
  };
}

function topoSort(nodes: PlanNode[]): PlanNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set<string>();
  const result: PlanNode[] = [];
  function dfs(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const n = nodeMap.get(id);
    if (!n) return;
    for (const dep of n.depends_on) dfs(dep);
    result.push(n);
  }
  for (const n of nodes) dfs(n.id);
  return result;
}

async function defaultNodeRunner(
  node: PlanNode,
  ctx: ExecutorCtx,
  outputs: Record<string, PrimitiveOutput>,
): Promise<PrimitiveOutput> {
  const p = node.primitive;
  switch (p.op) {
    case "read_file":     return runReadFile(p);
    case "grep":          return runGrep(p, { cwd: ctx.cwd });
    case "git_log":       return runGitLog(p, { cwd: ctx.cwd });
    case "git_diff":      return runGitDiff(p, { cwd: ctx.cwd });
    case "health_score":  return runHealthScore(p, { cwd: ctx.cwd });
    case "prod_query":    return runProdQuery(p, { cwd: ctx.cwd });
    case "parallel":      return runParallel(p, { resolveRef: async (ref) => outputs[ref] });
    case "sequential":    return runSequential(p, { resolveRef: async (ref) => outputs[ref] });
    default: {
      const _exhaustive: never = p;
      throw new Error(`executor: unsupported primitive op: ${(_exhaustive as { op: string }).op}`);
    }
  }
}
