import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeResult, Plan } from "./types";

export interface TraceLogger {
  writePlan(plan: Plan): Promise<void>;
  writeNodeResult(r: NodeResult): Promise<void>;
  writeFinal(status: string): Promise<void>;
  close(): Promise<void>;
}

export function createTraceLogger(planId: string, dir: string): TraceLogger {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${planId}.jsonl`);
  let pending: Promise<void> = Promise.resolve();

  function write(kind: string, payload: object): Promise<void> {
    const line = JSON.stringify({ kind, ts: new Date().toISOString(), ...payload }) + "\n";
    // Chain writes serially with error recovery so one failure doesn't poison subsequent appends.
    pending = pending.then(() => appendFile(path, line, "utf8")).catch(() => undefined);
    return pending;
  }

  return {
    writePlan(plan) { return write("plan", { plan }); },
    writeNodeResult(r) { return write("node_result", r); },
    writeFinal(status) { return write("final", { status }); },
    async close() { await pending; },
  };
}
