import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReadFile } from "../src/primitives/read-file";

describe("read_file primitive", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rf-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("reads the file and returns kind: text", async () => {
    const file = join(dir, "hello.txt");
    writeFileSync(file, "hello world");
    const out = await runReadFile({ op: "read_file", path: file });
    expect(out.kind).toBe("text");
    expect(out.kind === "text" && out.value).toBe("hello world");
  });

  test("rejects path traversal", async () => {
    await expect(runReadFile({ op: "read_file", path: "../../etc/passwd" })).rejects.toThrow(/path/);
  });

  test("throws on missing file", async () => {
    await expect(runReadFile({ op: "read_file", path: join(dir, "nope.txt") })).rejects.toThrow();
  });
});
