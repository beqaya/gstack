import { homedir } from "node:os";
import { join } from "node:path";

export function synthRoot(): string {
  return join(homedir(), ".gstack", "synth");
}
export function synthLogDir(): string {
  return join(synthRoot(), "log");
}
export function synthTemplatesDir(): string {
  return join(synthRoot(), "templates");
}
export function planLogPath(planId: string): string {
  return join(synthLogDir(), `${planId}.jsonl`);
}
