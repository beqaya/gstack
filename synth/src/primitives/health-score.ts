import { spawn } from "node:child_process";
import type { Primitive, PrimitiveOutput } from "../types";

export async function runHealthScore(
  p: Extract<Primitive, { op: "health_score" }>,
  ctx: { cwd: string },
): Promise<PrimitiveOutput> {
  const out = await invokeHealth(ctx.cwd, p.surface);
  return parseHealthOutput(out, p.surface);
}

export function parseHealthOutput(stdout: string, surface: "code" | "prod" | "both"): PrimitiveOutput {
  const codeMatch = /code\s+(\d+(?:\.\d+)?)\/10/.exec(stdout);
  const prodMatch = /prod\s+(\d+(?:\.\d+)?)\/10/.exec(stdout);
  const code = codeMatch ? parseFloat(codeMatch[1]) : 0;
  const prod = prodMatch ? parseFloat(prodMatch[1]) : 0;
  let value = 0;
  if (surface === "code") value = code;
  else if (surface === "prod") value = prod;
  else value = (code + prod) / 2;
  return { kind: "score", value, details: { code, prod, surface } };
}

function invokeHealth(cwd: string, surface: string): Promise<string> {
  // Match gstack's actual headless invocation pattern (claude -p with slash command via stdin).
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.GSTACK_CLAUDE_BIN || "claude";
    const proc = spawn(claudeBin, ["-p", "--output-format", "json"], { cwd });
    let stdout = "", stderr = "";
    proc.stdout?.on("data", d => (stdout += d.toString()));
    proc.stderr?.on("data", d => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`health: rc=${code} stderr=${stderr.slice(0, 200)}`));
    });
    proc.stdin?.end(`/health --surface ${surface}`);
  });
}
