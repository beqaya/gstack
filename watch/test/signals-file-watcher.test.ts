import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileWatcher } from "../src/signals/file-watcher";

describe("file watcher", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "fw-"));
    mkdirSync(join(repo, "src"));
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  test("fires file-changed signal when a watched file is edited", async () => {
    const received: any[] = [];
    const watcher = await createFileWatcher(repo, sig => received.push(sig), 50);

    writeFileSync(join(repo, "src", "a.ts"), "hello");
    await new Promise(r => setTimeout(r, 300));

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].source).toBe("file");
    expect(received[0].type).toBe("file-changed");
    await watcher.close();
  });

  test("ignores node_modules", async () => {
    mkdirSync(join(repo, "node_modules"));
    const received: any[] = [];
    const watcher = await createFileWatcher(repo, sig => received.push(sig), 50);

    writeFileSync(join(repo, "node_modules", "junk.ts"), "x");
    await new Promise(r => setTimeout(r, 300));

    expect(received.length).toBe(0);
    await watcher.close();
  });
});
