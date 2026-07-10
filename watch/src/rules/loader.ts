import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "js-yaml";
import type { Rule } from "../types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_PATH = join(HERE, "..", "..", "default-rules.yaml");

interface RawRuleFile {
  version: number;
  rules: Rule[];
}

export async function loadDefaultRules(): Promise<Rule[]> {
  const raw = await readFile(DEFAULT_RULES_PATH, "utf8");
  const parsed = load(raw) as RawRuleFile;
  if (parsed.version !== 1) {
    throw new Error(`unsupported rules version: ${parsed.version}`);
  }
  if (!Array.isArray(parsed.rules)) {
    throw new Error("rules file: 'rules' must be an array");
  }
  for (const r of parsed.rules) validateRule(r);
  return parsed.rules;
}

function validateRule(r: Rule): void {
  if (!r.id || typeof r.id !== "string") throw new Error("rule missing id");
  if (!r.on?.source || !r.on?.type) throw new Error(`rule ${r.id}: missing on.source/on.type`);
  if (!r.action?.type) throw new Error(`rule ${r.id}: missing action.type`);
  // Defense-in-depth runtime check: TS narrows skill to required for auto-run/suggest,
  // but YAML can bypass type checking entirely.
  if (r.action.type === "auto-run" || r.action.type === "suggest") {
    if (!("skill" in r.action) || !r.action.skill) {
      throw new Error(`rule ${r.id}: action ${r.action.type} requires skill`);
    }
  }
}
