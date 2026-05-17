import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRecentEntries } from "../src/cli/tail";

describe("tail reader", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tail-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("reads last N entries", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const file = join(dir, `${today}.jsonl`);
    writeFileSync(file, ["a","b","c","d","e"].map(x => JSON.stringify({ x })).join("\n"));
    const entries = await readRecentEntries(dir, 3);
    expect(entries.length).toBe(3);
    expect(entries[2].x).toBe("e");
  });

  test("returns [] when log dir is empty", async () => {
    const entries = await readRecentEntries(dir, 10);
    expect(entries).toEqual([]);
  });
});
