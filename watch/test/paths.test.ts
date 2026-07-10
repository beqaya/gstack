import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { gstackDataDir, watchLogDir, watchPidFile, watchSocketPath } from "../src/paths";

describe("watch paths", () => {
  test("gstackDataDir resolves to ~/.gstack", () => {
    expect(gstackDataDir()).toBe(join(homedir(), ".gstack"));
  });

  test("watchLogDir is under gstackDataDir", () => {
    expect(watchLogDir()).toBe(join(homedir(), ".gstack", "watch", "log"));
  });

  test("watchPidFile is daemon.pid", () => {
    expect(watchPidFile()).toBe(join(homedir(), ".gstack", "watch", "daemon.pid"));
  });

  test("watchSocketPath returns named pipe on Windows, socket path elsewhere", () => {
    const p = watchSocketPath();
    if (process.platform === "win32") {
      expect(p.startsWith("\\\\.\\pipe\\")).toBe(true);
    } else {
      expect(p.endsWith("/daemon.sock")).toBe(true);
    }
  });
});
