import { runEval } from "../eval/runner";
import { callLlm } from "../engine/llm-caller";
import { spawnSync } from "node:child_process";

export function formatEvalReport(results: { id: string; ok: boolean; reasons: string[] }[]): string {
  const passed = results.filter(r => r.ok).length;
  const lines = [`Eval: ${passed} / ${results.length} passed`, ""];
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗";
    lines.push(`  ${tag} ${r.id}${r.reasons.length > 0 ? ` — ${r.reasons.join("; ")}` : ""}`);
  }
  return lines.join("\n");
}

export async function cliEval(cwd: string = process.cwd(), model = "claude-sonnet-4-6"): Promise<void> {
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
  const results = await runEval({
    llmCall: (prompt) => callLlm(prompt, { model }),
    projectContext: { branch: branch || "(unknown)", recentCommits: [] },
  });
  console.log(formatEvalReport(results));
  const passed = results.filter(r => r.ok).length;
  process.exit(passed === results.length ? 0 : 1);
}
