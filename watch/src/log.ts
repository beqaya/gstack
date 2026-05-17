import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

export interface LogWriter {
  write(entry: object): Promise<void>;
  close(): Promise<void>;
}

function todayFilename(): string {
  return `${new Date().toISOString().slice(0, 10)}.jsonl`;
}

export function createLogWriter(dir: string): LogWriter {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let pending: Promise<void> = Promise.resolve();

  return {
    async write(entry: object) {
      const line = JSON.stringify(entry) + "\n";
      pending = pending.then(() => appendFile(join(dir, todayFilename()), line, "utf8"));
      await pending;
    },
    async close() {
      await pending;
    },
  };
}
