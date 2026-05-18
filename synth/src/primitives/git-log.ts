import { spawn } from "node:child_process";
import type { Primitive, PrimitiveOutput } from "../types";

const VALID_RANGE_RE = /^[A-Za-z0-9_./~^-]+(\.\.[A-Za-z0-9_./~^-]+)?$/;

export function validateRange(range: string | undefined): boolean {
  if (range === undefined) return true;
  return VALID_RANGE_RE.test(range);
}

export async function runGitLog(
  p: Extract<Primitive, { op: "git_log" }>,
  ctx: { cwd: string },
): Promise<PrimitiveOutput> {
  if (!validateRange(p.range)) {
    throw new Error(`git_log: invalid range: ${p.range}`);
  }
  const args = ["log"];
  if (p.format) args.push(`--format=${p.format}`);
  else args.push("--oneline");
  if (p.range) args.push(p.range);
  return runGit(args, ctx);
}

export function runGit(args: string[], ctx: { cwd: string }): Promise<PrimitiveOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd: ctx.cwd });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => (stdout += d.toString()));
    proc.stderr.on("data", d => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve({ kind: "text", value: stdout });
      else reject(new Error(`git ${args[0]} failed (rc=${code}): ${stderr.slice(0, 300)}`));
    });
  });
}
