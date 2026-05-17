import chokidar, { type FSWatcher } from "chokidar";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Signal } from "../types";

// Chokidar 4+ removed glob support — we watch directories directly and
// rely on the IGNORED regex to filter out junk paths.
const WATCHED_DIRS = ["src", "test", "lib", "migrations"];
const IGNORED = /(^|[\/\\])(node_modules|\.git|dist|build|coverage)([\/\\]|$)/;

export interface FileWatcher {
  close(): Promise<void>;
}

export async function createFileWatcher(
  repoRoot: string,
  handler: (signal: Signal) => void,
  debounceMs = 500,
): Promise<FileWatcher> {
  // Only watch directories that exist — chokidar emits an "error" for missing
  // paths, and the test repo only creates a subset of these.
  const paths = WATCHED_DIRS
    .map(d => join(repoRoot, d))
    .filter(p => existsSync(p));

  // If nothing exists, fall back to the repo root so we still pick up
  // newly-created watched dirs (chokidar will tree-walk from here, with
  // IGNORED filtering out node_modules / dist / etc).
  const watchPaths = paths.length > 0 ? paths : [repoRoot];

  const watcher: FSWatcher = chokidar.watch(watchPaths, {
    ignored: IGNORED,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: debounceMs, pollInterval: 50 },
  });

  await new Promise<void>((resolve, reject) => {
    watcher.once("ready", () => resolve());
    watcher.once("error", err => reject(err));
  });

  watcher.on("all", (event, path) => {
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    handler({
      id: `sig_${randomUUID()}`,
      source: "file",
      type: "file-changed",
      repo: repoRoot,
      timestamp: new Date().toISOString(),
      metadata: { event, files: [path] },
    });
  });

  return { close: () => watcher.close() };
}
