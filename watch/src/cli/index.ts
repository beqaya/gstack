import { cliStart } from "./start";
import { cliStop } from "./stop";
import { cliStatus } from "./status";
import { cliTail } from "./tail";

export interface ParsedArgs {
  command: "start" | "stop" | "status" | "tail";
  repos: string[];
  limit?: number;
}

const COMMANDS = ["start", "stop", "status", "tail"] as const;

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || !(COMMANDS as readonly string[]).includes(cmd)) {
    throw new Error(`unknown command: ${cmd ?? "(none)"}; expected one of ${COMMANDS.join(", ")}`);
  }
  let limit: number | undefined;
  const repos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === "--limit") {
      limit = parseInt(rest[++i], 10);
    } else if (tok.startsWith("--")) {
      throw new Error(`unknown flag: ${tok}`);
    } else {
      repos.push(tok);
    }
  }
  return { command: cmd as ParsedArgs["command"], repos, limit };
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  switch (args.command) {
    case "start":  return cliStart(args.repos.length > 0 ? args.repos : [process.cwd()]);
    case "stop":   return cliStop();
    case "status": return cliStatus();
    case "tail":   return cliTail(args.limit ?? 50);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(err => {
    console.error("[gstack-watch]", err.message);
    process.exit(1);
  });
}
