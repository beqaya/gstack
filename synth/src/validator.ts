import { allPrimitives, isReadOnly } from "./primitives/registry";
import type { Plan, PlanNode } from "./types";

const MAX_NODES = 50;
const MAX_DEPTH = 6;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validatePlan(plan: Plan): ValidationResult {
  const errors: string[] = [];

  if (plan.nodes.length === 0) errors.push("plan: must contain at least one node");
  if (plan.nodes.length > MAX_NODES) errors.push(`plan: exceeds max nodes (${plan.nodes.length} > ${MAX_NODES})`);

  const nodeMap = new Map<string, PlanNode>();
  for (const n of plan.nodes) {
    if (nodeMap.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeMap.set(n.id, n);

    if (!allPrimitives().includes(n.primitive.op)) {
      errors.push(`node ${n.id}: primitive '${n.primitive.op}' is not registered (Phase 1.1-1.3 supports read-only only)`);
      continue;
    }
    if (!isReadOnly(n.primitive.op)) {
      errors.push(`node ${n.id}: primitive '${n.primitive.op}' is mutating; Phase 1.1-1.3 forbids mutating primitives`);
    }
  }

  for (const n of plan.nodes) {
    for (const dep of n.depends_on) {
      if (!nodeMap.has(dep)) errors.push(`node ${n.id}: depends_on missing node '${dep}'`);
    }
  }

  const cycle = findCycle(plan.nodes);
  if (cycle.length > 0) errors.push(`cycle detected: ${cycle.join(" → ")}`);

  if (errors.length === 0) {
    const depth = computeMaxDepth(plan.nodes);
    if (depth > MAX_DEPTH) errors.push(`plan depth ${depth} exceeds limit ${MAX_DEPTH}`);
  }

  return { ok: errors.length === 0, errors };
}

function findCycle(nodes: PlanNode[]): string[] {
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function dfs(id: string): string[] {
    if (onStack.has(id)) {
      const idx = stack.indexOf(id);
      return stack.slice(idx).concat([id]);
    }
    if (visited.has(id)) return [];
    visited.add(id);
    onStack.add(id);
    stack.push(id);
    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.depends_on) {
        const c = dfs(dep);
        if (c.length > 0) return c;
      }
    }
    stack.pop();
    onStack.delete(id);
    return [];
  }

  for (const n of nodes) {
    const c = dfs(n.id);
    if (c.length > 0) return c;
  }
  return [];
}

function computeMaxDepth(nodes: PlanNode[]): number {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const memo = new Map<string, number>();

  function depth(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    const node = nodeMap.get(id);
    if (!node || node.depends_on.length === 0) {
      memo.set(id, 1);
      return 1;
    }
    const d = 1 + Math.max(...node.depends_on.map(depth));
    memo.set(id, d);
    return d;
  }

  return Math.max(...nodes.map(n => depth(n.id)));
}
