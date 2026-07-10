import { validateRange, runGit } from "./git-log";
import type { Primitive, PrimitiveOutput } from "../types";

export async function runGitDiff(
  p: Extract<Primitive, { op: "git_diff" }>,
  ctx: { cwd: string },
): Promise<PrimitiveOutput> {
  if (!validateRange(p.range)) {
    throw new Error(`git_diff: invalid range: ${p.range}`);
  }
  const args = ["diff"];
  if (p.range) args.push(p.range);
  return runGit(args, ctx);
}
