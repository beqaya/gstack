import { describe, expect, test } from "bun:test";
import { backoffMs, superviseDaemon, type SpawnedChild } from "../src/supervisor";

describe("supervisor backoff", () => {
  test("starts at 1s and doubles up to 60s cap", () => {
    expect(backoffMs(0)).toBe(1_000);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(5)).toBe(32_000);
    expect(backoffMs(6)).toBe(60_000);  // capped
    expect(backoffMs(20)).toBe(60_000); // still capped
  });
});

/**
 * Build a fake child that fires "exit" with the given code after `exitAfterMs`.
 * Captures listeners so the test can assert kill() was called on stop.
 */
function fakeChild(exitCode: number, exitAfterMs = 1): SpawnedChild & { killed: boolean } {
  const listeners: Record<string, ((arg: unknown) => void)[]> = { exit: [], error: [] };
  const child = {
    killed: false,
    on(event: string, cb: (arg: unknown) => void) {
      listeners[event]?.push(cb);
      return this;
    },
    kill(_sig: NodeJS.Signals | number) {
      this.killed = true;
      return true;
    },
  };
  setTimeout(() => {
    for (const cb of listeners.exit) cb(exitCode);
  }, exitAfterMs);
  return child as SpawnedChild & { killed: boolean };
}

describe("supervisor respawn", () => {
  test("respawns the worker when it exits with non-zero code", async () => {
    const spawnCalls: string[][] = [];
    const handle = superviseDaemon(["repo-a"], {
      spawnFn: (args) => {
        spawnCalls.push(args);
        return fakeChild(1, 1);
      },
      delayMs: () => 1,
      log: () => {}, // silence
    });

    // Let several restart cycles happen.
    await new Promise(r => setTimeout(r, 40));
    handle.stop();

    expect(spawnCalls.length).toBeGreaterThan(1);
    for (const args of spawnCalls) expect(args).toEqual(["repo-a"]);
  });

  test("does NOT respawn after stop() is called", async () => {
    let spawnCount = 0;
    const handle = superviseDaemon([], {
      spawnFn: () => {
        spawnCount += 1;
        return fakeChild(1, 1);
      },
      delayMs: () => 5,
      log: () => {},
    });

    // Stop immediately, then wait long enough that another restart WOULD have fired.
    handle.stop();
    const countAtStop = spawnCount;
    await new Promise(r => setTimeout(r, 30));

    // Exactly one spawn happened (the initial), no respawns after stop.
    expect(countAtStop).toBe(1);
    expect(spawnCount).toBe(1);
  });

  test("propagates args to every spawn invocation", async () => {
    const argCaptures: string[][] = [];
    const handle = superviseDaemon(["repo-1", "repo-2", "repo-3"], {
      spawnFn: (args) => {
        argCaptures.push([...args]);
        return fakeChild(2, 1);
      },
      delayMs: () => 1,
      log: () => {},
    });
    await new Promise(r => setTimeout(r, 25));
    handle.stop();

    expect(argCaptures.length).toBeGreaterThanOrEqual(2);
    for (const captured of argCaptures) {
      expect(captured).toEqual(["repo-1", "repo-2", "repo-3"]);
    }
  });
});
