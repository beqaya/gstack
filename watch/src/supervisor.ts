import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAEMON_ENTRY = join(HERE, "cli", "start.ts");

export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1_000 * Math.pow(2, attempt));
}

export interface SupervisorHandle {
  stop(): void;
}

export function superviseDaemon(args: string[] = []): SupervisorHandle {
  let attempt = 0;
  let stopped = false;
  let current: ReturnType<typeof spawn> | null = null;

  function start() {
    if (stopped) return;
    current = spawn("bun", [DAEMON_ENTRY, "--worker", ...args], {
      stdio: "inherit",
      env: { ...process.env, GSTACK_WATCH_WORKER: "1" },
    });
    current.on("exit", code => {
      if (stopped) return;
      console.error(`[watch] daemon worker exited with code ${code}; restarting in ${backoffMs(attempt)}ms`);
      const delay = backoffMs(attempt);
      attempt = Math.min(attempt + 1, 10);
      setTimeout(start, delay);
    });
    current.on("error", err => {
      console.error("[watch] supervisor spawn error:", err);
    });
  }

  start();
  return {
    stop() {
      stopped = true;
      current?.kill("SIGTERM");
    },
  };
}
