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

export interface SpawnedChild {
  on(event: "exit", cb: (code: number | null) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  kill(sig: NodeJS.Signals | number): unknown;
}

export interface SupervisorTestSeam {
  /** Inject a spawn function for tests; default spawns `bun start.ts --worker`. */
  spawnFn?: (args: string[]) => SpawnedChild;
  /** Inject a backoff function for tests so respawn loops run in milliseconds, not seconds. */
  delayMs?: (attempt: number) => number;
  /** Logger seam — defaults to console.error. Tests can capture. */
  log?: (msg: string) => void;
}

// gstack-watch worker runs TypeScript directly via `bun`. Node alone cannot
// execute the daemon entry without a transpile step, so bun is required.
// Operators can point at a non-default bun binary via GSTACK_WATCH_BUN_BIN.
function defaultSpawn(args: string[]): SpawnedChild {
  const bunBin = process.env.GSTACK_WATCH_BUN_BIN || "bun";
  return spawn(bunBin, [DAEMON_ENTRY, "--worker", ...args], {
    stdio: "inherit",
    env: { ...process.env, GSTACK_WATCH_WORKER: "1" },
  });
}

export function superviseDaemon(args: string[] = [], seam: SupervisorTestSeam = {}): SupervisorHandle {
  const spawnFn = seam.spawnFn ?? defaultSpawn;
  const delayFn = seam.delayMs ?? backoffMs;
  const log = seam.log ?? ((m: string) => console.error(m));
  let attempt = 0;
  let stopped = false;
  let current: SpawnedChild | null = null;

  function start() {
    if (stopped) return;
    current = spawnFn(args);
    current.on("exit", code => {
      if (stopped) return;
      const delay = delayFn(attempt);
      log(`[watch] daemon worker exited with code ${code}; restarting in ${delay}ms`);
      attempt = Math.min(attempt + 1, 10);
      setTimeout(start, delay);
    });
    current.on("error", err => {
      log(`[watch] supervisor spawn error: ${err.message}`);
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
