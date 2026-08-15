import { describe, expect, test } from "bun:test";
import { primitiveMetadata, allPrimitives, isReadOnly } from "../src/primitives/registry";

describe("primitive registry", () => {
  test("allPrimitives lists the salvaged primitives", () => {
    // health_score was dropped at salvage (it nested a full claude -p session).
    expect(allPrimitives().sort()).toEqual([
      "git_diff", "git_log", "grep",
      "parallel", "prod_query", "read_file", "sequential",
    ]);
  });

  test("read_file metadata declares inputs and read-only", () => {
    const m = primitiveMetadata("read_file");
    expect(m.mutating).toBe(false);
    expect(m.inputs).toContain("path");
    expect(m.outputs).toContain("text");
  });

  test("isReadOnly returns true for all Phase 1.1-1.3 primitives", () => {
    for (const op of allPrimitives()) {
      expect(isReadOnly(op)).toBe(true);
    }
  });

  test("primitiveMetadata throws for unknown op", () => {
    expect(() => primitiveMetadata("write_file")).toThrow(/not registered/);
  });
});
