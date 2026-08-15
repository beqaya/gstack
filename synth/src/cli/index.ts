import { cliReplay } from "./replay";

// The LLM plan engine (`synth <goal>`) and its eval suite were dropped at
// salvage: they spent an extra model call producing a DAG of primitives the
// in-session model can already call directly. Replay of recorded traces is
// the deterministic half that earns its keep.
export interface ParsedArgs {
  command: "replay";
  planId?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd !== "replay") {
    throw new Error(`unknown command: ${cmd ?? "(none)"}; expected replay`);
  }
  return { command: "replay", planId: rest.find((t) => !t.startsWith("--")) };
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.planId) throw new Error("usage: replay <plan_id>");
  return cliReplay(a.planId);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(err => {
    console.error("[gstack-synth]", err.message);
    process.exit(1);
  });
}
