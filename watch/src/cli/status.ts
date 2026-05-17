import { readPidFile } from "./start";
import { watchPidFile, watchLogDir } from "../paths";
import { loadDefaultRules } from "../rules/loader";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface StatusSnapshot {
  running: boolean;
  pid: number | null;
  ruleCount: number;
  watchedRepos: string[];
  recentActionCount: number;
}

export function formatStatus(s: StatusSnapshot): string {
  if (!s.running) return "gstack watch: not running";
  const lines = [
    `gstack watch: running (pid ${s.pid})`,
    `  rules: ${s.ruleCount} rules loaded`,
    `  watched repos:`,
    ...s.watchedRepos.map(r => `    - ${r}`),
    `  recent actions (24h): ${s.recentActionCount}`,
  ];
  return lines.join("\n");
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function countRecentActions(logDir: string): number {
  if (!existsSync(logDir)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const path = join(logDir, `${today}.jsonl`);
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter(l => l.trim().length > 0).length;
}

export async function cliStatus(): Promise<void> {
  const pid = readPidFile(watchPidFile());
  const running = pid !== null && isAlive(pid);
  const rules = running ? await loadDefaultRules() : [];
  // Phase 1: repos list lives in process env if running; not persisted to disk yet.
  // Fall back to empty list — future versions persist repo list to ~/.gstack/watch/repos.json.
  const snapshot: StatusSnapshot = {
    running,
    pid,
    ruleCount: rules.length,
    watchedRepos: [],
    recentActionCount: countRecentActions(watchLogDir()),
  };
  console.log(formatStatus(snapshot));
}
