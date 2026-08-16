import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root of gstack's on-disk state. Honors the GSTACK_HOME env override (same
 * pattern as bin/gstack-memory-ingest.ts and the design tests) so tests can
 * point watch state at a temp dir. Read at call time, not module load, so a
 * test that sets process.env.GSTACK_HOME after import still wins.
 */
export function gstackDataDir(): string {
  return process.env.GSTACK_HOME || join(homedir(), ".gstack");
}

export function watchRoot(): string {
  return join(gstackDataDir(), "watch");
}

export function watchLogDir(): string {
  return join(watchRoot(), "log");
}

/** Where git hooks drop one JSON event file per signal (the T14 transport). */
export function watchInboxDir(): string {
  return join(watchRoot(), "inbox");
}

/** Where the drain quarantines inbox files that fail to parse. */
export function watchDeadDir(): string {
  return join(watchRoot(), "dead");
}
