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
    // Serialize writes; recover from transient errors so one failure doesn't poison
    // the chain — but surface the error so the user knows their trace is incomplete.
    pending = pending
      .then(() => appendFile(path, line, "utf8"))
      .catch(err => console.error(`[synth/trace] write failed for ${planId}: ${(err as Error)?.message ?? err}`));
    return pending;
  }

  return {
    writePlan(plan) { return write("plan", { plan }); },
    writeNodeResult(r) { return write("node_result", r); },
    writeFinal(status) { return write("final", { status }); },
    async close() { await pending; },
  };
}
