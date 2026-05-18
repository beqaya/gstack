import { cliSynth } from "./synth";
import { cliReplay } from "./replay";
import { cliEval } from "./eval";

export interface ParsedArgs {
  command: "synth" | "replay" | "eval";
  goal?: string;
  planId?: string;
  mode: "plan-only" | "execute";
}

const COMMANDS = ["synth", "replay", "eval"] as const;

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || !(COMMANDS as readonly string[]).includes(cmd)) {
    throw new Error(`unknown command: ${cmd ?? "(none)"}; expected one of ${COMMANDS.join(", ")}`);
  }
  const args: ParsedArgs = { command: cmd as ParsedArgs["command"], mode: "plan-only" };
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === "--mode") {
      const m = rest[++i];
      if (m !== "plan-only" && m !== "execute") throw new Error(`invalid --mode: ${m}`);
      args.mode = m;
    } else if (tok.startsWith("--")) {
      throw new Error(`unknown flag: ${tok}`);
    } else {
      positional.push(tok);
    }
  }
  if (args.command === "synth") {
    args.goal = positional.join(" ");
  } else if (args.command === "replay") {
    args.planId = positional[0];
  }
  return args;
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  switch (a.command) {
    case "synth":
      if (!a.goal) throw new Error("usage: synth <goal>");
      return cliSynth({ goal: a.goal, mode: a.mode });
    case "replay":
      if (!a.planId) throw new Error("usage: replay <plan_id>");
      return cliReplay(a.planId);
    case "eval":
      return cliEval();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(err => {
    console.error("[gstack-synth]", err.message);
    process.exit(1);
  });
}
