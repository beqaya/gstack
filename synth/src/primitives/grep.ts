import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { minimatch } from "minimatch";
import type { Primitive, PrimitiveOutput } from "../types";

// Reject metacharacters that could enable command injection if a future implementation
// changes back to a spawn-based grep (defense in depth — current impl never shells out).
const FORBIDDEN_PATTERN_CHARS = /[;|&`$<>]/;
const MAX_FILES_SCANNED = 5_000;

export async function runGrep(
  p: Extract<Primitive, { op: "grep" }>,
  ctx: { cwd: string },
): Promise<PrimitiveOutput> {
  if (FORBIDDEN_PATTERN_CHARS.test(p.pattern)) {
    throw new Error(`grep: pattern contains forbidden shell metacharacters: ${p.pattern}`);
  }
  const regex = new RegExp(p.pattern);
  const root = p.path ? (p.path.startsWith(".") ? join(ctx.cwd, p.path) : p.path) : ctx.cwd;
  const glob = p.glob ?? "**/*";

  const files: string[] = [];
  await collectFiles(root, ctx.cwd, glob, files);

  const matches: string[] = [];
  for (const f of files) {
    let text: string;
    try { text = await readFile(f, "utf8"); } catch { continue; }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push(`${relative(ctx.cwd, f).replace(/\\/g, "/")}:${i + 1}:${lines[i]}`);
      }
    }
  }
  return { kind: "lines", value: matches };
}

async function collectFiles(dir: string, cwd: string, glob: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES_SCANNED) return;
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { return; }
  for (const e of entries) {
    if (out.length >= MAX_FILES_SCANNED) return;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      await collectFiles(full, cwd, glob, out);
    } else if (e.isFile()) {
      const rel = relative(cwd, full).replace(/\\/g, "/");
      if (minimatch(rel, glob)) out.push(full);
    }
  }
  // Touch unused param so linters don't complain when minimatch happens to be cheap enough.
  void stat;
}
