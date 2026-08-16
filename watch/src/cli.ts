import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { drainInbox } from "./drain";
import { installGitHooks, uninstallGitHooks } from "./signals/git-hooks";
import { watchDeadDir, watchInboxDir, watchLogDir } from "./paths";

export interface ParsedArgs {
  command: "drain" | "status" | "install-hooks" | "uninstall-hooks";
  repo?: string;
  limit?: number;
}

const COMMANDS = ["drain", "status", "install-hooks", "uninstall-hooks"] as const;

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || !(COMMANDS as readonly string[]).includes(cmd)) {
    throw new Error(`unknown command: ${cmd ?? "(none)"}; expected one of ${COMMANDS.join(", ")}`);
  }
  let limit: number | undefined;
  let repo: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === "--limit") {
      limit = parseInt(rest[++i], 10);
    } else if (tok.startsWith("--")) {
      throw new Error(`unknown flag: ${tok}`);
    } else if (repo === undefined) {
      repo = tok;
    } else {
      throw new Error(`unexpected argument: ${tok}`);
    }
  }
  return { command: cmd as ParsedArgs["command"], repo, limit };
}

function countJsonFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(n => n.endsWith(".json") && !n.startsWith(".")).length;
}

function tailActionLog(limit: number): string[] {
  const logDir = watchLogDir();
  if (!existsSync(logDir)) return [];
  const files = readdirSync(logDir).filter(n => n.endsWith(".jsonl")).sort();
  const lines: string[] = [];
  // Walk newest log files backwards until we have enough lines.
  for (let i = files.length - 1; i >= 0 && lines.length < limit; i--) {
    const body = readFileSync(join(logDir, files[i]), "utf8");
    const fileLines = body.split("\n").filter(l => l.trim().length > 0);
    lines.unshift(...fileLines.slice(-(limit - lines.length)));
  }
  return lines;
}

async function cliDrain(): Promise<void> {
  const s = await drainInbox();
  console.log(
    `[gstack-watch] drain: ${s.scanned} scanned, ${s.processed} processed, ` +
    `${s.deferred} deferred, ${s.poisoned} moved to dead/`,
  );
}

function cliStatus(limit: number): void {
  console.log(`[gstack-watch] inbox: ${countJsonFiles(watchInboxDir())} pending event(s) (${watchInboxDir()})`);
  console.log(`[gstack-watch] dead:  ${countJsonFiles(watchDeadDir())} poison file(s) (${watchDeadDir()})`);
  const lines = tailActionLog(limit);
  if (lines.length === 0) {
    console.log("[gstack-watch] action log: empty");
    return;
  }
  console.log(`[gstack-watch] last ${lines.length} action log line(s):`);
  for (const l of lines) console.log(l);
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repo = resolve(args.repo ?? process.cwd());
  switch (args.command) {
    case "drain": return cliDrain();
    case "status": return cliStatus(args.limit ?? 20);
    case "install-hooks":
      await installGitHooks(repo);
      console.log(`[gstack-watch] installed post-commit/post-merge hooks in ${repo} (inbox: ${watchInboxDir()})`);
      return;
    case "uninstall-hooks":
      await uninstallGitHooks(repo);
      console.log(`[gstack-watch] removed gstack hooks from ${repo} (user hooks restored from .gstack.bak where present)`);
      return;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(err => {
    console.error("[gstack-watch]", err.message);
    process.exit(1);
  });
}
