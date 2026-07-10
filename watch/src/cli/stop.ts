import { unlinkSync, existsSync } from "node:fs";
import { readPidFile } from "./start";
import { watchPidFile } from "../paths";

export type StopAction =
  | { kind: "no-pid-file" }
  | { kind: "stale"; pid: number }
  | { kind: "kill"; pid: number };

export function computeStopAction(pid: number | null, isAlive: (p: number) => boolean): StopAction {
  if (pid === null) return { kind: "no-pid-file" };
  if (!isAlive(pid)) return { kind: "stale", pid };
  return { kind: "kill", pid };
}

export async function cliStop(): Promise<void> {
  const pidPath = watchPidFile();
  const pid = readPidFile(pidPath);
  const action = computeStopAction(pid, p => { try { process.kill(p, 0); return true; } catch { return false; } });

  switch (action.kind) {
    case "no-pid-file":
      console.log("gstack watch is not running");
      return;
    case "stale":
      console.log(`removing stale pid file (pid ${action.pid} not alive)`);
      if (existsSync(pidPath)) unlinkSync(pidPath);
      return;
    case "kill":
      try {
        process.kill(action.pid, "SIGTERM");
        console.log(`sent SIGTERM to pid ${action.pid}`);
      } catch (err: any) {
        console.error(`failed to signal pid ${action.pid}: ${err.message}`);
        process.exit(1);
      }
      if (existsSync(pidPath)) unlinkSync(pidPath);
      return;
  }
}
