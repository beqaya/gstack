import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogWriter } from "../src/log";

describe("log writer", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gstack-watch-log-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("appends a single JSONL line", async () => {
    const log = createLogWriter(dir);
    await log.write({ kind: "test", value: 1 });
    await log.close();
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(dir, `${today}.jsonl`), "utf8");
    expect(content.trim()).toBe('{"kind":"test","value":1}');
  });

  test("appends multiple lines in order", async () => {
    const log = createLogWriter(dir);
    await log.write({ n: 1 });
    await log.write({ n: 2 });
    await log.write({ n: 3 });
    await log.close();
    const today = new Date().toISOString().slice(0, 10);
    const lines = readFileSync(join(dir, `${today}.jsonl`), "utf8").trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).n).toBe(1);
    expect(JSON.parse(lines[2]).n).toBe(3);
  });
});
