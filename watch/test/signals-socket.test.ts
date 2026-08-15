import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createSocketServer } from "../src/signals/socket";

describe("socket signal server", () => {
  let socketPath: string;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sock-"));
    socketPath = process.platform === "win32"
      ? `\\\\.\\pipe\\gstack-test-${Date.now()}`
      : join(dir, "daemon.sock");
  });

  test("receives a JSON signal and dispatches to handler", async () => {
    const received: any[] = [];
    const srv = await createSocketServer(socketPath, sig => { received.push(sig); });

    await new Promise<void>((resolve, reject) => {
      const client = require("node:net").createConnection(socketPath);
      client.on("connect", () => {
        client.end(JSON.stringify({ source: "git", type: "post-commit", repo: "/r", metadata: {} }) + "\n");
      });
      client.on("close", () => resolve());
      client.on("error", reject);
    });

    await new Promise(r => setTimeout(r, 100));
    expect(received.length).toBe(1);
    expect(received[0].source).toBe("git");
    await srv.close();
  });
});
