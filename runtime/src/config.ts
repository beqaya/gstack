import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "js-yaml";
import type { ObservabilityConfig } from "./types";

const CONFIG_FILE = ".claude/observability.yaml";
const CLAUDE_MD = "CLAUDE.md";

export async function loadObservabilityConfig(repoRoot: string): Promise<ObservabilityConfig | null> {
  const yamlPath = join(repoRoot, CONFIG_FILE);
  if (existsSync(yamlPath)) {
    const raw = await readFile(yamlPath, "utf8");
    const parsed = load(raw) as { observability?: ObservabilityConfig };
    if (!parsed?.observability) return null;
    validateObservabilityConfig(parsed.observability);
    return parsed.observability;
  }

  const claudePath = join(repoRoot, CLAUDE_MD);
  if (existsSync(claudePath)) {
    const raw = await readFile(claudePath, "utf8");
    const block = extractYamlBlock(raw, /^observability:/m);
    if (block) {
      const parsed = load(block) as { observability?: ObservabilityConfig };
      if (!parsed?.observability) return null;
      validateObservabilityConfig(parsed.observability);
      return parsed.observability;
    }
  }
  return null;
}

export function validateObservabilityConfig(cfg: ObservabilityConfig): void {
  if (!cfg.primary) throw new Error("observability.primary is required");
  if (!cfg.project_id) throw new Error("observability.project_id is required");
  if (cfg.region_lock && !cfg.region) {
    throw new Error("observability.region is required when region_lock is true");
  }
  if (!Array.isArray(cfg.secondary)) {
    throw new Error("observability.secondary must be an array");
  }
  if (!cfg.providers || typeof cfg.providers !== "object") {
    throw new Error("observability.providers must be an object");
  }
}

function extractYamlBlock(md: string, anchor: RegExp): string | null {
  const fence = /```ya?ml\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md))) {
    if (anchor.test(m[1])) return m[1];
  }
  return null;
}
