import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePidFile, readPidFile } from "../src/cli/start";

describe("pid file management", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test("writes pid file and round-trips read", () => {
    dir = mkdtempSync(join(tmpdir(), "pid-"));
    const path = join(dir, "daemon.pid");
    writePidFile(path, 12345);
    expect(existsSync(path)).toBe(true);
    expect(readPidFile(path)).toBe(12345);
  });

  test("read returns null when file absent", () => {
    expect(readPidFile("/nonexistent/path.pid")).toBeNull();
  });
});
