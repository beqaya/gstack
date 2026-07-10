import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { startDaemon } from "../daemon";
import { installGitHooks } from "../signals/git-hooks";
import { watchPidFile, watchSocketPath, watchLogDir } from "../paths";
import { superviseDaemon } from "../supervisor";

export function writePidFile(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(pid), "utf8");
}

export function readPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export async function cliStart(repos: string[]): Promise<void> {
  const pidPath = watchPidFile();
  const existing = readPidFile(pidPath);
  if (existing !== null && isAlive(existing)) {
    console.error(`gstack watch is already running (pid ${existing})`);
    process.exit(1);
  }

  if (process.env.GSTACK_WATCH_WORKER === "1") {
    // We're the worker. Run the daemon directly.
    mkdirSync(watchLogDir(), { recursive: true });
    const socketPath = watchSocketPath();
    for (const repo of repos) {
      await installGitHooks(repo, socketPath);
    }
    const handle = await startDaemon({
      repos, socketPath, enableFileWatcher: true, enableScheduler: true,
    });
    writePidFile(pidPath, process.pid);
    process.on("SIGTERM", async () => { await handle.stop(); process.exit(0); });
    process.on("SIGINT",  async () => { await handle.stop(); process.exit(0); });
    return;
  }

  // We're the launcher. Fork the supervisor.
  superviseDaemon(repos);
  console.log(`gstack watch started (watching ${repos.length} repo${repos.length === 1 ? "" : "s"})`);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
