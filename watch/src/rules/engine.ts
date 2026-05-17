import { randomUUID } from "node:crypto";
import { evaluatePredicates } from "./predicates";
import type { Action, RepoState, Rule, Signal } from "../types";

export interface ResolvedAction {
  action_id: string;
  rule_id: string;
  signal_id: string;
  action: Action;
  notify: Rule["notify"];
  resolved_at: string;
}

export interface RuleEngine {
  evaluate(signal: Signal, repo: RepoState): ResolvedAction[];
}

export function createRuleEngine(rules: Rule[]): RuleEngine {
  return {
    evaluate(signal, repo): ResolvedAction[] {
      const out: ResolvedAction[] = [];
      for (const rule of rules) {
        if (rule.on.source !== signal.source) continue;
        if (rule.on.type !== signal.type) continue;
        try {
          if (!evaluatePredicates(rule.when, signal, repo)) continue;
        } catch (err) {
          // Defensive: malformed predicate (e.g., bad branch.age expr) should
          // not crash the engine. Log and skip the rule.
          console.warn(
            `[watch] rule ${rule.id} predicate threw, skipping: ${(err as Error).message}`,
          );
          continue;
        }
        out.push({
          action_id: `act_${randomUUID()}`,
          rule_id: rule.id,
          signal_id: signal.id,
          action: rule.action,
          notify: rule.notify,
          resolved_at: new Date().toISOString(),
        });
      }
      return out;
    },
  };
}
