import { minimatch } from "minimatch";
import type { Signal, RepoState } from "../types";

export function evaluatePredicates(
  predicates: Record<string, unknown> | undefined,
  signal: Signal,
  repo: RepoState,
): boolean {
  if (!predicates || Object.keys(predicates).length === 0) return true;

  for (const [key, value] of Object.entries(predicates)) {
    if (!evaluateOne(key, value, signal, repo)) return false;
  }
  return true;
}

function evaluateOne(key: string, value: unknown, signal: Signal, repo: RepoState): boolean {
  switch (key) {
    case "files.match":
      return matchFiles(value as string[], signal);
    case "branch.age":
      return compareHours(value as string, repo.branchAgeHours);
    case "branch.has_diff":
      return repo.hasDiff === Boolean(value);
    case "branch.is_default":
      return repo.isDefaultBranch === Boolean(value);
    case "check_name":
      return signal.metadata.check_name === value;
    default:
      // Unknown predicate: log + return false to be safe
      console.warn(`[watch] unknown predicate: ${key}`);
      return false;
  }
}

function matchFiles(globs: string[], signal: Signal): boolean {
  const files = (signal.metadata.files as string[] | undefined) ?? [];
  if (files.length === 0) return false;
  return files.some(f => globs.some(g => minimatch(f, g)));
}

function compareHours(expr: string, actual: number): boolean {
  // expr like "> 72h", "< 24h", ">= 5h"
  const m = expr.match(/^(>=|<=|>|<|==)\s*(\d+(?:\.\d+)?)h$/);
  if (!m) throw new Error(`invalid age expression: ${expr}`);
  const op = m[1];
  const threshold = parseFloat(m[2]);
  switch (op) {
    case ">": return actual > threshold;
    case "<": return actual < threshold;
    case ">=": return actual >= threshold;
    case "<=": return actual <= threshold;
    case "==": return actual === threshold;
    default: return false;
  }
}
