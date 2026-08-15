import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { watchLogDir } from "../paths";

export async function readRecentEntries(logDir: string, limit: number): Promise<any[]> {
  const today = new Date().toISOString().slice(0, 10);
  const path = join(logDir, `${today}.jsonl`);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(l => l.trim().length > 0);
  const slice = lines.slice(-limit);
  return slice.map(l => {
    try { return JSON.parse(l); } catch { return { raw: l, parse_error: true }; }
  });
}

export async function cliTail(limit = 50): Promise<void> {
  const entries = await readRecentEntries(watchLogDir(), limit);
  if (entries.length === 0) {
    console.log("(no actions logged today)");
    return;
  }
  for (const e of entries) {
    console.log(JSON.stringify(e));
  }
}
