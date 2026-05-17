import { randomUUID } from "node:crypto";
import type { Signal } from "../types";

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function msUntilNextDaily(hhmm: string, now: Date = new Date()): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) throw new Error(`invalid HH:MM: ${hhmm}`);
  const target = new Date(now);
  target.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export interface Scheduler {
  close(): void;
}

export function startDailyScheduler(
  hhmm: string,
  repos: string[],
  handler: (signal: Signal) => void,
): Scheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    const ms = msUntilNextDaily(hhmm);
    timer = setTimeout(() => {
      for (const repo of repos) {
        handler({
          id: `sig_${randomUUID()}`,
          source: "time",
          type: "daily",
          repo,
          timestamp: new Date().toISOString(),
          metadata: { hhmm },
        });
      }
      schedule();
    }, ms);
  }

  schedule();
  return {
    close() { if (timer) clearTimeout(timer); },
  };
}
