import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGrep } from "../src/primitives/grep";

describe("grep primitive", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "TODO: refactor\nfunction f() {}\n");
    writeFileSync(join(dir, "src", "b.ts"), "no match here\n");
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("returns lines matching pattern in glob", async () => {
    const out = await runGrep({ op: "grep", pattern: "TODO", glob: "**/*.ts" }, { cwd: dir });
    expect(out.kind).toBe("lines");
    expect(out.kind === "lines" && out.value.length).toBe(1);
    expect(out.kind === "lines" && out.value[0]).toContain("TODO: refactor");
  });

  test("returns empty lines array on no match", async () => {
    const out = await runGrep({ op: "grep", pattern: "ZZZ_NOPE_ZZZ", glob: "**/*.ts" }, { cwd: dir });
    expect(out.kind).toBe("lines");
    expect(out.kind === "lines" && out.value.length).toBe(0);
  });

  test("rejects pattern that contains dangerous shell characters", async () => {
    await expect(runGrep({ op: "grep", pattern: "; rm -rf /", glob: "*" }, { cwd: dir })).rejects.toThrow();
  });
});
